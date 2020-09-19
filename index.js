const request = require('request');
const url = require('url');
const createError = require('http-errors')

let Service, Characteristic;
const meUrl = 'https://api.butterflymx.com:443/mobile/v3/me';
const unlockUrl = 'https://api.butterflymx.com:443/mobile/v3/door_release_requests';
const refreshUrl = 'https://accounts.butterflymx.com/oauth/token';

function butterflyMx(log, config) {
	this.configPrinted = false;
	this.log = log;

	this.clientId = config['clientId'];
	this.refreshToken = config['refreshToken'];
	this.authToken = config['authToken'];

	this.unitId = config['unitId'];
	this.panelId = config['panelId'];
}

butterflyMx.prototype = {
	wrappedRequest: function(req, callback) {
		const me = this;
		me.log.debug(`Requesting ${req.url}`);
		request(req, callback);
	},

	dispatchRequest: function(next, requestObject, callback) {
		const me = this;
		me.wrappedRequest(requestObject, function(error, response, body) {
			try {
				if(error) throw error;
				if(response.statusCode == 401) {
					me.log.warn('Attempting to obtain updated credentials');
					me.doRefresh(requestObject, callback);
				} else {
					callback(error, response, body);
				}
			} catch(ex) {
				me.log.error('Failed to dispatch a request', ex);
			}
		})
	},

	doRefresh: function(nextRequest, nextCallback) {
		const me = this;

		const requestBody = {
			refresh_token: me.refreshToken,
			client_id: me.clientId,
			grant_type: 'refresh_token',
		};

		const requestObj = {
			url: refreshUrl,
			method: 'POST',
			body: JSON.stringify(requestBody),
			headers: { 'Content-Type': 'application/json' }
		};

		me.wrappedRequest(requestObj, function(error, response, body) {
			try {
				if(error) throw error;
				if (response.statusCode != 200) throw createError(response.statusCode, body);

				const result = JSON.parse(body);

				me.authToken = result.access_token;
				me.refreshToken = result.refresh_token;
				nextRequest.headers['Authorization'] = `Bearer ${me.authToken}`;

				me.wrappedRequest(nextRequest, nextCallback);
			} catch(ex) {
				me.log.error('Failed to refresh token', ex);
			}
		});
	},

	getSwitchOnCharacteristic: function(next) {
		const me = this;

		// take advantage of this opportunity to verify we are configured correctly
		if(!this.configPrinted) {
			const requestObj = {
				url: meUrl,
				method: 'GET',
				headers: { 'Authorization': 'Bearer ' + me.authToken },
			};

			me.dispatchRequest(next, requestObj, function(error, response, body) {
				try {
					if(error) throw error;
					if (response.statusCode != 200) {
						throw createError(response.statusCode, response.body);
					}

					const result = JSON.parse(body);
					const resultUnit = result.included.filter(inc => inc.type == 'units')[0];
					const resultBuilding = result.included.filter(inc => inc.type == 'buildings')[0];

					me.log.info(`Configured for ${resultBuilding.attributes.name} ${resultUnit.attributes.label}`);
					me.configPrinted = true;
				} catch(ex) {
					me.log.warn('Failed to get lock status', ex);
				}

				return next(null, false);	// we can't introspect the state of the door release so just always say that it's "off"
			});
		} else {
			return next(null, false);	// we can't introspect the state of the door release so just always say that it's "off"
		}
	},

	setSwitchOnCharacteristic: function(on, next) {
		const me = this;
		me.log.info('Unlocking door...');

		const requestBody = Object.entries({
			'data[type]': 'door_release_requests',
			'data[attributes][release_method]': 'front_door_view',
			'data[relationships][unit][data][id]': me.unitId,
			'data[relationships][panel][data][id]': me.panelId,
		}).map(pair => `${encodeURI(pair[0])}=${encodeURI(pair[1])}`).join('&');

		const requestObj = {
			url: unlockUrl,
			body: requestBody,
			method: 'POST',
			headers: {
				'Authorization': 'Bearer ' + me.authToken,
				'Content-Type': 'application/x-www-form-urlencoded',
			}
		};

		me.dispatchRequest(next, requestObj, function(error, response, body) {
			try {
				if(error) throw error;
				if (![200, 201].includes(response.statusCode)) throw createError(response.statusCode, body);

				const result = JSON.parse(body);
				me.log.info(`Created unlock request ${result.data.id}`);

				return next();
			} catch(ex) {
				me.log.error('Failed to unlock door', ex);
				return next(ex);
			}
		});

	},

	getServices: function() {
		let informationService = new Service.AccessoryInformation();
		informationService
			.setCharacteristic(Characteristic.Manufacturer, 'ButterflyMx')
			.setCharacteristic(Characteristic.Model, 'ButterflyMx')

		let butterflyService = new Service.Switch('ButterflyMx Unlock');
		butterflyService
			.getCharacteristic(Characteristic.On)
			.on('get', this.getSwitchOnCharacteristic.bind(this))
			.on('set', this.setSwitchOnCharacteristic.bind(this));

		return [informationService, butterflyService];
	}
}

module.exports = function(homebridge) {
		Service = homebridge.hap.Service;
		Characteristic = homebridge.hap.Characteristic;
		homebridge.registerAccessory('homebridge-butterfly-mx', 'ButterflyMx', butterflyMx);
}
