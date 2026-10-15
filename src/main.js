import { createRuntime } from './render/runtime.js';

const params = new URLSearchParams(window.location.search);
const fixed = params.get('fixed') === '1';
const frame = Number(params.get('frame') ?? 0);
const app = document.querySelector('#app');

window.waterwingRuntime = createRuntime(app, { fixed, frame });
