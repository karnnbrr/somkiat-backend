// ============================================================
// Queue Boundary — Step 29 §7/§10, Step 30B §8
//
// This is an INTERFACE, not a vendor choice. Step 29 explicitly said
// "DECIDE LATER" on Redis/RabbitMQ/SQS/Kafka — there's still no network
// access in this environment to install any of them, and no business
// need yet to justify one. What's here is the minimal contract that
// Business Logic code depends on (`enqueue`/`process`), backed today by
// a trivial in-process array. Swapping in a real queue later means
// writing one new file that implements this same `enqueue`/`onProcess`
// shape — no service or route code changes.
//
// Three named queues per the Step 29 diagram: inbound, aiProcessing, outbound.
// ============================================================
'use strict';

function createInProcessQueue(name) {
  const jobs = [];
  let handler = null;

  return {
    name,
    /** Add a job. Returns the job with a generated id and 'queued' state. */
    enqueue(payload) {
      const job = { id: `${name}-${jobs.length + 1}`, payload, state: 'queued', enqueued_at: new Date().toISOString() };
      jobs.push(job);
      if (handler) drain();
      return job;
    },
    /** Register the (single) processor for this queue. */
    onProcess(fn) {
      handler = fn;
      drain();
    },
    /** Inspect current contents — for tests/observability only. */
    peekAll() {
      return jobs.slice();
    },
    size() {
      return jobs.filter((j) => j.state === 'queued').length;
    },
  };

  function drain() {
    for (const job of jobs) {
      if (job.state !== 'queued') continue;
      try {
        handler(job.payload);
        job.state = 'processed';
      } catch (e) {
        job.state = 'failed';
        job.error = e.message;
      }
    }
  }
}

const inboundQueue = createInProcessQueue('inbound');
const aiProcessingQueue = createInProcessQueue('aiProcessing');
const outboundQueue = createInProcessQueue('outbound');

module.exports = { createInProcessQueue, inboundQueue, aiProcessingQueue, outboundQueue };
