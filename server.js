// Default value for host
var THISHOST = "chrisirhc.no.de";
var DEVELOPMENT_HOST = "gtevents.localhost:3000";
var FBKEY = 'xxxxxxxxxxxxxxx';
var FBSECRET = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
var DEVELOPMENT_FBKEY = 'xxxxxxxxxxxxxxx';
var DEVELOPMENT_FBSECRET = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

/**
 * This is where it all begins
 */
var express = require("express");
var request = require("request");
var redis = require("redis"),
  rclient = redis.createClient();

var fbclient = require('./lib/facebook-js');

var app = express.createServer();

/** development / production switch **/
app.set('env', 'development');

// Setup the server
app.configure(function () {
  app.use(express.conditionalGet());
  app.use(express.cache());
  app.use(express.gzip());

  app.use(express.logger());
  app.use(express.bodyDecoder());
  app.use(express.methodOverride());
  app.use(express.cookieDecoder());
  app.set('jsonp callback', true);
});

app.configure('production', function() {
  app.use(express.errorHandler());
  app.listen(80);
  console.log("Listening to 80");
});

app.configure('development', function() {
  THISHOST = DEVELOPMENT_HOST;
  FBKEY = DEVELOPMENT_FBKEY;
  FBSECRET = DEVELOPMENT_FBSECRET;
  app.listen(3000);
  console.log("Listening to 3000");
});

/** Setup API keys **/
fbclient = fbclient(
  FBKEY,
  FBSECRET
);

/**
 * Facebook Authentication
 */
 
app.get('/auth', function (req, res) {
  fbclient.getAccessToken(
    {redirect_uri: 'http://' + THISHOST + '/auth',
     code: req.param('code')},
     function (error, token) {
        console.log('access token : '+ token.access_token);
        res.redirect('profile/'+token.access_token);
    });
});

/**
 * Fetch User Facebook Info
 */
app.get('/profile/:token', function (req, res, next) {
  fbclient.apiCall('GET', '/me',
            {access_token: req.params.token},
            function (error, result){
               
                var id=result.id.toString();
                rclient.del(id);
                rclient.hmset(id, result);
                rclient.hgetall(id, function (err, result) {
                    res.send('Your data<br/>'+result.name);
                });
                
    });
});


/**
 * Facbook Login Page
 * TODO: check access token
 */
 
app.get('/login', function (req, res, next) {
  //request permission
  res.redirect(fbclient.getAuthorizeUrl({
    client_id: FBKEY,
    redirect_uri: 'http://' + THISHOST + '/auth',
    scope:      'offline_access,publish_stream,user_events,friends_events,create_event,rsvp_event'
  }));
});
  
  
/**
 * Events listing
 * Smart sort not implemented yet
 * Also no limit set
 */

app.get('/', function (req, res, next) {
  rclient.smembers("eventslist", function (err, result) {
    var multiget = rclient.multi();
    for (i = 0; i < result.length; i++) {
      multiget.hgetall(result[i]);
    }
    multiget.exec(function (err, replies) {
      if (!err) {
        res.send(replies);
      }
    });
  });
});

app.get('/help', function (req, res, next) {
  res.send('<ul><li><a href="/list">List</a></li>'
           + '<li><a href="/fetch">Fetch</a></li>'
           + '<li><a href="/clear">Clear</a></li></ul>');
});

/** This will be how to fetch the data *manually* for now **/
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
    var multi = rclient.multi();
    if (!err) {
      multi.del(results).del("eventslist").exec(function (err) {
        if (!err) {
          res.send(200);
        }
      });
    }
  });
});

/**
 * View details per id.
 */
app.get('/:id', function (req, res, next) {
  rclient.hgetall(req.params.id, function (err, result) {
    res.send(result);
  });
});

// Store a database of connected/authenticated users

// Process the users like a cron job

// Wait for requests from the mobile web application and serve them
