if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
	window.$resizeStaticContent = () => {
    console.log('[Mock] resizeStaticContent function activated');
  };
	window.$redirectAllLinks = () => {
    console.log('[Mock] redirectAllLinks function activated');
  };
	window.$redirect = () => {
		console.log('[Mock] redirect function activated');
	};
	window.$redirectToUrl = (url) => {
		console.log('[Mock] redirectToUrl function activated', url);
	};
	window.DOT = {
		hit: (event, data) => {
			console.log(`[Mock DOT.hit] Event "${event}" triggered with data:`, data);
		},
	};
	window.scriptLoader = {
		async load(scriptUrl) {
			return new Promise((resolve, reject) => {
				const script = document.createElement('script');
				script.onload = () => {
					console.log(`Script "${scriptUrl}" loaded`);
					resolve();
				};
				script.onerror = (error) => {
					console.error(`Error loading script "${scriptUrl}"`);
					reject(error);
				};

				script.src = scriptUrl;
				document.body.appendChild(script);
			});
		},
	};
}
