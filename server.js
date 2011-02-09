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
var fbapptoken='';

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

fbclient.getAppToken(function (res) {
	fbapptoken = res;
	}
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
 * Fetch Event Feed
 */
app.get('/eventwall/:eid', function (req, res, next) {
	fbclient.apiCall(
		'GET',
		'/' + req.params.eid + '/feed',
		{access_token: fbapptoken},
		function (error, result) {
			 for (i = result.data.length; i--;) {
					var date = result.data[i].updated_time;
					var year = date.substr(0, 4);
					var mth = date.substr(5, 2);
					var day = date.substr(8, 2);
					var hour = date.substr(11, 2);
					var min = date.substr(14, 2);
					var sec = date.substr(17, 2);
				  result.data[i].update_time = new Date(year, mth, day, hour, min, sec).getTime();
					result.data[i].name = result.data[i].from.name;
					result.data[i].message = result.data[i].message;
					if(result.data[i].description)
						result.data[i].message = result.data[i].message.concat(" ").concat(result.data[i].description);
					result.data[i].id = result.data[i].from.id; //user id
					delete result.data[i].picture;
					delete result.data[i].from;
					delete result.data[i].to;
					delete result.data[i].type;
					delete result.data[i].created_time;
					delete result.data[i].updated_time;
					delete result.data[i].link;
					delete result.data[i].caption;
					delete result.data[i].description;
					delete result.data[i].icon;
					delete result.data[i].likes; 
			
        }
			res.send(result.data);
		}
		);
});


/**
 * Event RSVP List - Attend
 */
app.get('/rsvp_attend/:eid', function (req, res, next) {
	fbclient.getEventRSVPList(
		req.params.eid,
		fbapptoken,
		fbclient.RSVP_ATTENDING,
		function (error, result) {
			for (i = result.data.length; i--;) {
					delete result.data[i].rsvp_status;
	      }
			res.send(result.data);
		}
		);
});

/**
 * Event RSVP List - Declined
 */
app.get('/rsvp_declined/:eid', function (req, res, next) {
	fbclient.getEventRSVPList(
		req.params.eid,
		fbapptoken,
		fbclient.RSVP_DECLINED,
		function (error, result) {
			for (i = result.data.length; i--;) {
				delete result.data[i].rsvp_status;
      }
			res.send(result.data);
		}
		);
});

/**
 * Event RSVP List - Maybe
 */
app.get('/rsvp_maybe/:eid', function (req, res, next) {
	fbclient.getEventRSVPList(
		req.params.eid,
		fbapptoken,
		fbclient.RSVP_MAYBE,
		function (error, result) {
			for (i = result.data.length; i--;) {
				delete result.data[i].rsvp_status;
      }
			res.send(result.data);
		}
		);
});


/**
 * Event RSVP List - NoReply
 */
app.get('/rsvp_noreply/:eid', function (req, res, next) {
	fbclient.getEventRSVPList(
		req.params.eid,
		fbapptoken,
		fbclient.RSVP_NOREPLY,
		function (error, result) {
			for (i = result.data.length; i--;) {
					delete result.data[i].rsvp_status;
	    }
			res.send(result.data);
		}
		);
});

/**
 * Search Event
 */
app.get('/event_search/:string', function (req, res, next) {
	var arr = [];

	fbclient.searchEvent(
		req.params.string,
		function (error, result) {
			for (i = 0; i < result.data.length; i++) {
				arr[i] = result.data[i].id;
      }
			
			var fql = "SELECT eid, name, pic_small, pic_big, pic, start_time, " +
								"end_time, host, description FROM event WHERE " +
								" eid IN (" + arr.join(',') + ")";
			fbclient.fqlCall(
				{access_token: fbapptoken,
				 query:fql,
				 format:'json',
				},
				function (err, result) {
					res.send(result);
				}
			)

		}
	);

});


/**
 * Event Detail
 */
app.get('/event_detail/:eid', function (req, res, next) {
	fbclient.getEventDetail(
		req.params.eid,
		function (error, result) {
			res.send(result);
		}
		);
});

/**
 * Get Event Created by User
 */
app.get('/event_created/:uid', function(req, res, next){
	rclient.hmget(req.params.uid, 'access_token', function (err, result) {
		fbclient.getEventsCreated(req.params.uid, 
			result[0],
			function(error, events){
				res.send(events);
			});
		});
});

/**
 * Get Event Participated by User
 */
app.get('/event_participated/:uid', function(req, res, next){
	rclient.hmget(req.params.uid, 'access_token', function (err, result) {
		fbclient.getEventsParticipated(req.params.uid, 
			result[0],
			function(error, events){
				res.send(events);
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
	
		var fql = "SELECT eid, name, pic_small, pic_big, pic, start_time, " +
							"end_time, host, description FROM event WHERE " +
							" eid IN (" + result.join(',') + ")";
		fbclient.fqlCall(
			{access_token: fbapptoken,
			 query:fql,
			 format:'json',
			},
			function (err, result) {
				res.send(result);
			}
		);
	});
  
	/*
	 rclient.smembers("eventslist", function (err, result) {
    var htmlStr = "<ul>";
    for(var i = result.length; i--;) {
      htmlStr += '<li><a href="/' + result[i] + '">' + result[i] + '</a></li>';
    }
    htmlStr += "</ul>";
    res.send(htmlStr);
  });
  */
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
