/**
 * This is where it all begins
 */
var express = require("express");
var request = require("request");
var redis = require("redis"),
  rclient = redis.createClient();

var app = express.createServer();

/** debugging **/
app.set('env', 'production');

// Setup the server
app.configure(function () {
  app.use(express.conditionalGet());
  app.use(express.cache());
  app.use(express.gzip());
  /** if it's a file, serve it **/
  app.use(express.compiler({src: __dirname + '/public', enable: ['less']}));
  app.use(express.staticProvider(__dirname + '/public'));

  app.use(express.logger());
  app.use(express.bodyDecoder());
  app.use(express.methodOverride());
});

app.configure('production', function() {
  app.use(express.errorHandler());
  app.listen(80);
  console.log("Listening to 80");
});

app.configure('development', function() {
  app.listen(3000);
  console.log("Listening to 3000");
});

app.get('/', function (req, res, next) {
  res.send('<ul><li><a href="/list">List</a></li>'
           + '<li><a href="/fetch">Fetch</a></li>'
           + '<li><a href="/clear">Clear</a></li></ul>');
});

app.get('/fetch', function (req, res, next) {
  request({
    uri: "https://graph.facebook.com/search?q=%22georgia+tech%22&type=event&limit=50"
  },
    function (error, response, body) {
      var bodyObj, i, currId, hashArr;
      if (!error && response.statusCode == 200) {
        hashArr = [];
        bodyObj = JSON.parse(body);
        /** Care about the order later **/
        for (i = bodyObj.data.length; i--;) {
          currId = bodyObj.data[i]['id'];

          bodyObj.data[i]['start_time'] = new Date(bodyObj.data[i]['start_time']).getTime();
          bodyObj.data[i]['end_time'] = new Date(bodyObj.data[i]['end_time']).getTime();

          rclient.sadd("eventslist", currId);
          rclient.hmset(currId, bodyObj.data[i]);
        }
        res.send("Fetched");
      }
    });
});

app.get('/list', function (req, res, next) {
  rclient.smembers("eventslist", function (err, result) {
    var htmlStr = "<ul>";
    for(var i = result.length; i--;) {
      htmlStr += '<li><a href="/' + result[i] + '">' + result[i] + '</a></li>';
    }
    htmlStr += "</ul>";
    res.send(htmlStr);
  });
});

/** Should make this an atomic command but do it later **/
app.get('/clear', function (req, res, next) {
  rclient.smembers("eventslist", function (err, results) {
    if (!err) {
      rclient.del(results, function (err, results) {
        if (!err) {
          rclient.del("eventslist");
          res.send("Done.");
        }
      });
    }
  });
});

app.get('/:id', function (req, res, next) {
  rclient.hgetall(req.params.id, function (err, result) {
    res.send(result, { 'Content-Type': 'text/plain' });
  });
});

// Store a database of connected/authenticated users

// Process the users like a cron job

// Wait for requests from the mobile web application and serve them
