import { publishInstances } from '../../pubsub'

module.exports = (Instances) => (instances) => {
  const ts = Date.now()
  for (let instName in instances) {
    const instance = instances[instName]
    instance._ts = ts
    Instances.update({name: instName}, {$set: instance}, {upsert: true})
  }
  Instances.remove({ $and: [{_ts: {$ne: ts}}, {state: {$ne: 'created'}}]})
  Instances.find({}, (err, docs) => publishInstances(docs))
  
};

