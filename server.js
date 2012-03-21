/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Main entry-point for the Zones API.
 */

var path = require('path');
var fs = require('fs');

var filed = require('filed');
var restify = require('restify');
var ldap = require('ldapjs');
var Logger = require('bunyan');

var Heartbeater = require('./lib/heartbeater');
var interceptors = require('./lib/interceptors');
var machines = require('./lib/machines');
var tags = require('./lib/tags');

var Cache = require('expiring-lru-cache');

// var UFDS = require('sdc-clients').UFDS;
var UFDS = require('./lib/ufds');

var VERSION = false;


/**
 * Returns the current semver version stored in CloudAPI's package.json.
 * This is used to set in the API versioning and in the Server header.
 *
 * @return {String} version.
 */
function version() {
    if (!VERSION) {
        var pkg = fs.readFileSync(__dirname + '/package.json', 'utf8');
        VERSION = JSON.parse(pkg).version;
    }

    return VERSION;
}


/*
 * Loads and parse the configuration file at config.json
 */
function loadConfig() {
  var configPath = path.join(__dirname, 'config.json');

  if (!path.existsSync(configPath)) {
    log.error('Config file not found: "' + configPath +
      '" does not exist. Aborting.');
    process.exit(1);
  }

  var config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return config;
}

var config = loadConfig();

var log = new Logger({
  name: 'zapi',
  level: config.logLevel,
  serializers: {
    err: Logger.stdSerializers.err,
    req: Logger.stdSerializers.req,
    res: restify.bunyan.serializers.response
  }
});

config.amqp.log = log;


/*
 * ZAPI constructor
 */
function ZAPI(options) {
  this.config = options;

  this.server = restify.createServer({
    name: 'Zones API',
    log: log,
    version: version() || '7.0.0',
    serverName: 'SmartDataCenter',
    accept: ['text/plain',
             'application/json',
             'text/html',
             'image/png',
             'text/css'],
    contentWriters: {
     'text/plain': function(obj) {
       if (!obj)
         return '';
       if (typeof(obj) === 'string')
         return obj;
       return JSON.stringify(obj, null, 2);
      }
    }
  });

  this.server.on('uncaughtException', function(req, res, route, error) {
    req.log.info({
      err: error,
      url: req.url,
      params: req.params
    });

    res.send(new restify.InternalError("Internal Server Error"));
  });
}


/*
 * Sets custom middlewares to use for the API
 */
ZAPI.prototype.setMiddleware = function() {
  this.server.use(restify.acceptParser(this.server.acceptable));
  this.server.use(restify.authorizationParser());
  this.server.use(restify.bodyParser());
  this.server.use(restify.queryParser());
}


/*
 * Sets all routes for static content
 */
ZAPI.prototype.setStaticRoutes = function() {

  // TODO: static serve the docs, favicon, etc.
  //  waiting on https://github.com/mcavage/node-restify/issues/56 for this.
  this.server.get('/favicon.ico', function (req, res, next) {
      filed(__dirname + '/docs/media/img/favicon.ico').pipe(res);
      next();
  });
}


/*
 * Sets all routes for the ZAPI server
 */
ZAPI.prototype.setRoutes = function() {

  var before = [
    addProxies,
    interceptors.authenticate,
    interceptors.loadMachine
  ];

  machines.mount(this.server, before);
  tags.mount(this.server, before);
}


/*
 * Starts listening on the port given specified by config.api.port. Takes a
 * callback as an argument. The callback is called with no arguments
 */
ZAPI.prototype.listen = function(callback) {
  this.server.listen(this.config.api.port, '0.0.0.0', callback);
}



/*
 * Starts listening on the heartbeater AMQP queue
 */
ZAPI.prototype.initHeartbeater = function(callback) {
  var heartbeater = this.heartbeater = new Heartbeater(config.amqp);

  heartbeater.on('connectionError', function(err) {

    log.error("AMQP Connection Error " + err.code + ", re-trying in 5 seconds...");
    setTimeout(function() {
      heartbeater.reconnect();
    }, 5000);

  });

  //  ID   zonename  status
  // [ 0, 'global', 'running', '/', '', 'liveimg', 'shared', '0'
  heartbeater.on('heartbeat', function(hb) {
    // Call handler to store heartbeat on cache and update UFDS
    // log.debug(hb);
  });
}


/*
 * Loads UFDS into the request chain
 */
function addProxies(req, res, next) {
  req.config = config;
  req.ufds = ufds;

  return next();
}



var ufds;
var zapi = new ZAPI(config);

try {
  config.ufds.logLevel = config.logLevel;
  ufds = new UFDS(config.ufds);
} catch (e) {
  console.error('Invalid UFDS config: ' + e.message);
  process.exit(1);
}


ufds.on('ready', function() {
  zapi.setMiddleware();
  zapi.setStaticRoutes();
  zapi.setRoutes();

  zapi.initHeartbeater();

  zapi.listen(function() {
    log.info({url: zapi.server.url}, '%s listening', zapi.server.name);
  });
});

ufds.on('error', function(err) {
  log.error(err, 'error connecting to UFDS. Aborting.');
  process.exit(1);
});
