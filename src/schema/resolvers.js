import _ from "lodash";
import GraphQLJSON from "graphql-type-json";
import fetch from "node-fetch";
import yaml from "js-yaml";
import pubsub, {
  instancesAsyncIterator,
  bucketsAsyncIterator,
  appsAsyncIterator,
  publishApps,
  publishInstances,
  publishBuckets
} from "../pubsub";
import { stopInstance, startInstance, deleteBucket, copyBucket } from "../mqtt";
import { enhanceForBigBoat } from "../dockerComposeEnhancer";
const { GraphQLDateTime } = require("graphql-iso-date");
const APPSTORE_URL =
  "https://raw.githubusercontent.com/bigboat-io/appstore/master/apps.yml";

const pFindAll = (db, filter = {}) =>
  new Promise((resolve, reject) =>
    db.find(filter, (err, docs) => resolve(docs))
  );

export const resolvers = {
  JSON: GraphQLJSON,
  DateTime: GraphQLDateTime,
  Query: {
    apps: async (root, args, context) => pFindAll(context.db.Apps),
    instances: async (root, args, context) =>
      pFindAll(context.db.Instances, args),
    buckets: async (root, args, context) => pFindAll(context.db.Buckets),
    resources: async (root, args, context) => pFindAll(context.db.Resources),
    datastores: async (root, args, context) => pFindAll(context.db.DataStores),
    appstoreApps: async (root, args, context) => {
      return fetch(APPSTORE_URL)
        .then(res => res.text())
        .then(text => yaml.safeLoad(text));
    }
  },
  App: {
    id: app => app._id
  },
  Instance: {
    id: instance => instance._id,
    services: (instance, args) => {
      return Object.keys(instance.services)
        .filter(
          serviceName =>
            Object.keys(args).length != 0 ? args.name === serviceName : true
        )
        .map(key => Object.assign({ name: key }, instance.services[key]));
    }
  },
  Bucket: {
    id: b => b._id
  },
  Resource: {
    id: r => r._id
  },
  DataStore: {
    id: ds => ds._id
  },
  ServiceInfo: {
    logs: async si => {
      const logs = await fetch(si.logs["1000"]);
      const lines = await logs.text();
      return lines.split("\n").map(l => l.slice(8));
    }
  },
  ContainerInfo: container => {
    return container;
  },
  Subscription: {
    instances: {
      resolve: (payload, args, context, info) => payload,
      subscribe: () => instancesAsyncIterator()
    },
    buckets: {
      resolve: (payload, args, context, info) => payload,
      subscribe: () => bucketsAsyncIterator()
    },
    apps: {
      resolve: (payload, args, context, info) => payload,
      subscribe: () => appsAsyncIterator()
    }
  },
  Mutation: {
    createOrUpdateApp: async (root, data, { db: { Apps } }) => {
      const bigboatCompose = yaml.safeLoad(data.bigboatCompose);
      data.tags = bigboatCompose.tags || [];
      return new Promise((resolve, reject) => {
        Apps.update(
          _.pick(data, "name", "version"),
          { $set: data },
          { upsert: true, returnUpdatedDocs: true },
          (err, numDocs, doc) => resolve(doc)
        );
        pFindAll(Apps).then(docs => publishApps(docs));
      });
    },
    removeApp: async (root, data, { db: { Apps } }) => {
      return new Promise((resolve, reject) => {
        Apps.remove(_.pick(data, "name", "version"), {}, (err, numRemoved) => {
          resolve(numRemoved);
          pFindAll(Apps).then(docs => publishApps(docs));
        });
      });
    },
    startInstance: async (root, data, { db: { Instances, Apps } }) => {
      console.log("startInstance", data);
      return new Promise((resolve, reject) => {
        Apps.findOne(
          { name: data.appName, version: data.appVersion },
          (err, doc) => {
            if (doc == null) {
              return reject(
                `App ${data.appName}:${data.appVersion} does not exist.`
              );
            }
            const options =
              data.options && Object.keys(data.options).length > 0
                ? data.options
                : { storageBucket: data.name };
            const app = enhanceForBigBoat(data.name, options, doc);
            Instances.insert(
              {
                name: data.name,
                storageBucket: options.storageBucket,
                startedBy: "TBD",
                state: "created",
                desiredState: "running",
                status: "Request sent to agent",
                app: app,
                services: []
              },
              (err, newDoc) => {
                startInstance({
                  app: app,
                  instance: {
                    name: data.name,
                    options: options
                  }
                });
                pFindAll(Instances).then(docs => publishInstances(docs));
                resolve(newDoc);
              }
            );
          }
        );
      });
    },
    stopInstance: async (root, data, { db: { Instances } }) => {
      return new Promise((resolve, reject) => {
        const updateFields = {
          desiredState: "stopped",
          status: "Instance stop is requested",
          stoppedBy: 0 //ToDo: record actual user
        };
        Instances.update(
          _.pick(data, "name"),
          { $set: updateFields },
          { returnUpdatedDocs: true },
          (err, numDocs, doc) => {
            if (doc) {
              const body = {
                app: {
                  name: doc.app.name,
                  version: doc.app.version,
                  definition: "??",
                  bigboatCompose: "??"
                },
                instance: {
                  name: doc.name,
                  options: {}
                }
              };
              console.log("POST body", body);
              stopInstance(body);
              resolve(doc);
            } else reject(`Instance ${data.name} does not exist`);
          }
        );
      });
    },
    deleteBucket: async (root, data, { db: { Buckets } }) => {
      Buckets.update(
        { name: data.name },
        { $set: { isLocked: true } },
        (err, numDocs) => {
          pFindAll(Buckets).then(docs => publishBuckets(docs));
        }
      );
      deleteBucket(data.name);
      return 1;
    },
    copyBucket: async (root, data, { db: { Buckets } }) => {
      return new Promise((resolve, reject) => {
        Buckets.update(
          { name: data.sourceName },
          { $set: { isLocked: true } },
          (err, numDocs) => {
            Buckets.insert(
              { name: data.destinationName, isLocked: true },
              (err, newDoc) => {
                copyBucket(data.sourceName, data.destinationName);
                resolve(newDoc);
              }
            );
          }
        );
      });
    }
  }
};
