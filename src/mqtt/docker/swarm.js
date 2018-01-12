import { publishInstances } from '../../pubsub'

console.log('ieeeeeeeeeeee', publishInstances);


module.exports = (Instances) => (instances) => {
  const ts = Date.now()
  for (let instName in instances) {
    const instance = instances[instName]
    instance._ts = ts
    Instances.update({name: instName}, {$set: instance}, {upsert: true})
  }
  Instances.remove({_ts: {$ne: ts}})
  Instances.find({}, (err, docs) => publishInstances(docs))
  
};

