import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const mockUrl = pathToFileURL(new URL('../src/mock.mjs', import.meta.url).pathname);

const importMock = (mode) => import(`${mockUrl.href}?mode=${mode}`);

test('mock entry point installs the browser API only outside production', async () => {
	const previousNodeEnv = process.env.NODE_ENV;
	const previousWindow = globalThis.window;
	const previousDocument = globalThis.document;
	const previousLog = console.log;
	const previousError = console.error;

	try {
		globalThis.window = {};
		process.env.NODE_ENV = 'production';
		await importMock('production');
		assert.deepEqual(globalThis.window, {});

		const appendedScripts = [];
		globalThis.window = {};
		globalThis.document = {
			body: {
				appendChild(script) {
					appendedScripts.push(script);
					script.onload();
				},
			},
			createElement: () => ({}),
		};
		console.log = () => {};
		console.error = () => {};
		process.env.NODE_ENV = 'development';
		await importMock('development');

		assert.equal(typeof window.$resizeStaticContent, 'function');
		assert.equal(typeof window.$redirectAllLinks, 'function');
		assert.equal(typeof window.$redirect, 'function');
		assert.equal(typeof window.$redirectToUrl, 'function');
		assert.equal(typeof window.DOT.hit, 'function');
		assert.equal(typeof window.scriptLoader.load, 'function');

		await window.scriptLoader.load('/mock-script.js');
		assert.equal(appendedScripts.length, 1);
		assert.equal(appendedScripts[0].src, '/mock-script.js');

		const resolvedMock = import.meta.resolve('@esmj/cns-static-content-cli/mock');
		assert.equal(resolvedMock, pathToFileURL(new URL('../src/mock.mjs', import.meta.url).pathname).href);
	} finally {
		if (previousNodeEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = previousNodeEnv;
		}
		if (previousWindow === undefined) {
			delete globalThis.window;
		} else {
			globalThis.window = previousWindow;
		}
		if (previousDocument === undefined) {
			delete globalThis.document;
		} else {
			globalThis.document = previousDocument;
		}
		console.log = previousLog;
		console.error = previousError;
	}
});
