const request = require('request');
const url = require('url');

let Service, Characteristic;

function butterflyMx(log, config) {
	this.configPrinted = false;
	this.log = log;

	this.getUrl = url.parse(config['getUrl']);
	this.postUrl = url.parse(config['postUrl']);

	this.authToken = config['authToken'];
	this.unitId = config['unitId'];
	this.panelId = config['panelId'];
}

butterflyMx.prototype = {
	getSwitchOnCharacteristic: function(next) {
		const me = this;

		if(this.configPrinted) {
			return next(null, false);
		}

		// take advantage of this opportunity to verify we are configured correctly
		request({
			url: me.getUrl,
			method: 'GET',
			headers: { 'Authorization': 'Bearer ' + me.authToken },
		}, function(error, response, body) {
			if(error) {
				me.log.error('STATUS: ' + response.statusCode);
				me.log.error(error.message);
				return next(error);
			}

			const result = JSON.parse(body);
			const resultUnit = result.included.filter(inc => inc.type == 'units')[0];
			const resultBuilding = result.included.filter(inc => inc.type == 'buildings')[0];
			me.log.info(`Configured for ${resultBuilding.attributes.name} ${resultUnit.attributes.label}`);
			me.configPrinted = true;

			// we can't introspect the state of the door release so just always say that it's "off"
			return next(null, false);
		});
	},

	assemblePost: function(panelId, unitId, token) {
		const me = this;

		const contents = {
			'data[type]': 'door_release_requests',
			'data[attributes][release_method]': 'front_door_view',
			'data[relationships][unit][data][id]': unitId,
			'data[relationships][panel][data][id]': panelId,
		}

		const requestBody = Object.entries(contents).map(pair => `${encodeURI(pair[0])}=${encodeURI(pair[1])}`).join('&');

		const req = {
			url: me.postUrl,
			body: requestBody,
			method: 'POST',
			headers: {
				'Authorization': 'Bearer ' + token,
				'Content-Type': 'application/x-www-form-urlencoded',
			}
		};

		return req;
	},

	setSwitchOnCharacteristic: function(on, next) {
		const me = this;
		me.log.info('Unlocking door...');
		const requestObj = this.assemblePost(this.panelId, this.unitId, this.authToken);
		request(requestObj, function(error, response, body) {
			if(error) {
				me.log.error('STATUS: ' + response['statusCode']);
				me.log.error(error.message);
				return next(error);
			}

			const result = JSON.parse(body);
			me.log.info(`Created unlock request ${result.data.id}`);

			return next();
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
