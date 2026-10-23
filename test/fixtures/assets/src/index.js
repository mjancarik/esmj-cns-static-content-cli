import './index.css';
import data from './message.json';
import { formatMessage } from './message.js';

window.fixtureRuns = (window.fixtureRuns || 0) + 1;
window.fixtureData = data;
document.querySelector('#message').textContent = formatMessage(data);
document.querySelector('#message').classList.add('from-javascript');