import _ from 'lodash'
import GraphQLJSON from 'graphql-type-json';
import fetch from 'node-fetch'
import yaml from 'js-yaml'
import pubsub, {
  INSTANCES_TOPIC,
  BUCKETS_TOPIC,
  APPS_TOPIC,
} from '../pubsub'
import {
  stopInstance
} from '../mqtt'
const {
  GraphQLDateTime
} = require('graphql-iso-date');
const APPSTORE_URL = 'https://raw.githubusercontent.com/bigboat-io/appstore/master/apps.yml?token=AChK-kgLp_6c7x6vz8os0jNChmyPifVYks5aRlxIwA%3D%3D'

const pFindAll = (db) => new Promise((resolve, reject) => db.find({}, (err, docs) => resolve(docs)))

export const resolvers = {
  JSON: GraphQLJSON,
  DateTime: GraphQLDateTime,
  Query: {
    apps: async (root, args, context) => pFindAll(context.db.Apps),
    instances: async (root, args, context) => pFindAll(context.db.Instances),
    buckets: async (root, args, context) => pFindAll(context.db.Buckets),
    resources: async (root, args, context) => pFindAll(context.db.Resources),
    datastores: async (root, args, context) => pFindAll(context.db.DataStores),
    appstoreApps: async (root, args, context) => {
      return fetch(APPSTORE_URL).then(res => res.text()).then( text => yaml.safeLoad(text))
    },
  },
  App: {
    id: app => app._id
  },
  Instance: {
    id: instance => instance._id,
    services: instance => Object.keys(instance.services).map(key => Object.assign({name: key}, instance.services[key])),
  },
  Bucket: {
    id: b => b._id,
  },
  Resource: {
    id: r => r._id,
  },
  DataStore: {
    id: ds => ds._id,
  },
  LogsInfo: {
    n200: logs => logs['200'],
    n500: logs => logs['500'],
    n1000: logs => logs['1000'],
  },
  ContainerInfo: container => {console.log('cntr', container); return container},
  Subscription: {
    instances: {
      resolve: (payload, args, context, info) => payload,
      subscribe: () => pubsub.asyncIterator(INSTANCES_TOPIC),
    },
    buckets: {
      resolve: (payload, args, context, info) => payload,
      subscribe: () => pubsub.asyncIterator(BUCKETS_TOPIC),
    },
    apps: {
      resolve: (payload, args, context, info) => payload,
      subscribe: () => pubsub.asyncIterator(APPS_TOPIC),
    },
  },
  Mutation: {
    createOrUpdateApp: async (root, data, {db: {Apps}}) => {
      data.tags = []
      return new Promise((resolve, reject) => {
        Apps.update(_.pick(data, 'name', 'version'), {$set:data}, {upsert:true, returnUpdatedDocs: true}, (err, numDocs, doc) => resolve(doc))
      })
    },
    removeApp: async (root, data, {db: {Apps}}) => {
      return new Promise((resolve, reject) => {
        Apps.remove(_.pick(data, 'name', 'version'), {}, (err, numRemoved) => resolve(numRemoved))
      })
    },
    stopInstance: async (root, data, {db: {Instances}}) => {
      return new Promise((resolve, reject) => {
        const updateFields = {
          desiredState: 'stopped',
          status: 'Instance stop is requested',
          stoppedBy: 0, //ToDo: record actual user
        }
        Instances.update(_.pick(data, 'name'), {$set: updateFields}, {returnUpdatedDocs: true}, (err, numDocs, doc) => {
          if (doc) {
            const body = JSON.stringify({
              app: {
                name: doc.app.name,
                version: doc.app.version,
                definition: '??',
                bigboatCompose: '??',
              },
              instance: {
                name: doc.name,
                options: {},
              }
            })
            console.log('POST body', body);
            stopInstance(body)
            resolve(doc)
          } else reject(`Instance ${data.name} does not exist`)

        })
      }) 
    },
  }
}
