/* Deterministic protocol stub. Its tensors are artificial and have no ecological meaning. */
const http = require('node:http');
const runs = new Map();
const submitted = [];
const failures = new Set();
const model = {id: 'acceptance-synthetic', name: 'Synthetic protocol fixture', species: ['synthetic-fish', 'synthetic-algae']};
const send = (response, status, body) => {
  response.writeHead(status, {'Content-Type': 'application/json'});
  response.end(JSON.stringify(body));
};
http.createServer(async (request, response) => {
  if (request.url === '/v1/models') return send(response, 200, [model]);
  if (request.url === '/acceptance/status') return send(response, 200, {submitted});
  if (request.url.startsWith('/v1/runs/') && request.method === 'GET') {
    const run = runs.get(request.url.slice('/v1/runs/'.length));
    return send(response, run ? 200 : 404, run || {message: 'Unknown synthetic request'});
  }
  if (request.url !== '/v1/runs' || request.method !== 'POST') return send(response, 404, {});
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    const field = body.match(/name="request"\r\nContent-Type: application\/json\r\n\r\n([^]*?)\r\n--/);
    if (!field) throw Error('No multipart request field');
    const input = JSON.parse(field[1]);
    if (runs.has(input.run_id)) return send(response, 200, runs.get(input.run_id));
    submitted.push({id: input.run_id, seed: input.seed});
    // One deliberate failure after three durable seed checkpoints exercises retry.
    if (input.seed === 103 && !failures.has(103)) {
      failures.add(103);
      const failed = {run_id: input.run_id, status: 'failed', message: 'Deliberate acceptance failure'};
      runs.set(input.run_id, failed);
      return send(response, 200, failed);
    }
    const steps = [];
    for (let step = 0; step <= input.time.max_steps; step += input.time.sample_every) steps.push(step);
    if (steps.at(-1) !== input.time.max_steps) steps.push(input.time.max_steps);
    const cells = input.grid.width * input.grid.height, species = input.species;
    const tensor = Buffer.alloc(steps.length * cells * species.length * 4);
    for (let f = 0; f < steps.length; f++) for (let cell = 0; cell < cells; cell++) for (let s = 0; s < species.length; s++) {
      tensor.writeFloatLE(1 + (input.seed % 100) / 10 + f / 4 + s, ((f * cells + cell) * species.length + s) * 4);
    }
    const result = {run_id: input.run_id, status: 'completed', result: {dtype: 'float32',
      shape: [steps.length, input.grid.height, input.grid.width, species.length],
      steps, species, biomass_b64: tensor.toString('base64')}};
    runs.set(input.run_id, result);
    return send(response, 200, result);
  } catch (error) {
    return send(response, 400, {message: error.message});
  }
}).listen(8000, '0.0.0.0');
