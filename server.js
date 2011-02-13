// Default value for host
var THISHOST = "chrisirhc.no.de";
var DEVELOPMENT_HOST = "gtevents.localhost:3000";
var FBKEY = 'xxxxxxxxxxxxxxx';
var FBSECRET = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
var DEVELOPMENT_FBKEY = 'xxxxxxxxxxxxxxx';
var DEVELOPMENT_FBSECRET = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

/**
 * Constants
 */
var NUM_LIST_EVENT = 20; //number of events shown on list page
var NUM_LIST_ATTEND = 5; //number of attendees shown on list page
var NUM_FEED = 20; //number of event feeds
var FB_PAGES = new Array(
	'35150423420', //FerstCenter
	'104374712683', //CRC
	'104804139480', //College of Computing
	'311147925771', //Georgia Institute of Technology Bands 
	'15328653162', //Georgia Tech Athletics
	'105166199515818', //Georgia Tech Office of Success Programs"
	'135540189805805', //Georgia Tech Goldfellas
	'107518605955318', //Georgia Tech Student Center
	'59102723065', //Student Center Programs Council
	'8264471191', //Georgia Tech Library
	'363586652173', //Georgia Tech Career Services
	'44851172785', //Georgia Tech Crew
	'245926061925', //AIESEC Georgia Tec
	'85852244494', //Georgia Tech Hockey
	'184109331229', //Georgia Tech College of Management Undergraduate Program
	'179607177694', //Georgia Tech College of Architecture
	'190989114263815' //GtEvents  :)
);

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

/** Get Facebook Application Token (different from user access_token) **/
fbclient.getAppToken(function (res) {
	fbapptoken = res;
	fetchPageEvent(function (result) {
		fetchEventInfo(result);
	});
});


function fetchPageEvent(callback) {
	var eids = new Array();
	var j=1;
	for(var i=0; i<FB_PAGES.length; i++) {
		fbclient.apiCall('GET', 
			'/' + FB_PAGES[i] + '/events',
			{access_token: fbapptoken},
			function (err, res) {
				for (var i=0; i<res.data.length; i++) {
					if ((new Date(res.data[i].start_time)).getTime() > 
							(new Date()).getTime()) {
								 eids.push(res.data[i].id);
							}
				}
				//wait for all request to come back
				if(j++ == FB_PAGES.length) {
					callback(eids);
				}
			});
	}
}

function fetchEventInfo(eids) {
	var fqls = new Array();
	fqls['upcomingevents'] = 
		"SELECT eid, name, pic_small, pic_big, pic, start_time, end_time, host, description, location " +
				"FROM event WHERE eid IN (" + eids.join(',') +")";
	fqls['attendance'] = "SELECT eid, uid FROM event_member WHERE eid IN " +
				"(SELECT eid FROM #upcomingevents) AND rsvp_status = '" + fbclient.RSVP_ATTENDING + "'";
	fqls['attname'] = "SELECT name, uid FROM user WHERE uid IN " +
										"(SELECT uid FROM #attendance)";
	fbclient.multifqlCall(
			fqls,
			{access_token: fbapptoken,
			 format:'json',
			},
			function(err, result) {					
				var i, eve, user;					
				var multiadd = rclient.multi();

				for (i=0; i<result[0].fql_result_set.length; i++) {
					eve = result[0].fql_result_set[i];
					eve.start_time = eve.start_time * 1000; 
					eve.end_time = eve.end_time * 1000;
					eve.id = "event:fb:" + eve.eid;
					//store event
					multiadd.hmset('event:fb:'+eve.eid, eve);
					//add to event list
					multiadd.sadd('eventslist', 'event:fb:'+eve.eid);
					multiadd.sadd('eventslist:fb', 'event:fb:'+eve.eid);
					//fetch event feeds
					getEventFeed(eve.eid);
				}
							
				//store to attendance
				for (i = 0; i < result[1].fql_result_set.length; i++) {
					eve = result[1].fql_result_set[i];
					multiadd.sadd('attendance:fb:'+eve.eid, eve.uid);
				}							
				
				//store attendee name
				for (i=0; i<result[2].fql_result_set.length; i++) {
					user = result[2].fql_result_set[i];
					multiadd.hmset('fbuser:'+user.uid, user);
				}

				multiadd.exec(function (err, replies) {
					console.log('done fetching georgia tech events');
				});
		});
}
/**
 * Initialize User data
 * @param {Object} facebook user access_token
 */
function initUserInfo(gtid, fb_user_token) {
	fbclient.getMyProfile(
    fb_user_token,
  	function (err, res) {
			//store user info
			res.gtid = gtid;
			res.fbid = res.id;
			rclient.hmset('user:'+gtid, res);
			//store gtid <=> fbid mapping
			rclient.hmset('gtid:fb', gtid, res.id);
			rclient.hmset('fb:gtid', res.id, gtid);
			rclient.sadd('userslist', gtid);
			rclient.hmset('gtid:'+gtid, {name: res.name, fbid: res.id});
			
			var fqls = new Array();
			var now = parseInt((new Date().getTime())/1000);
			var uid = res.id;
			fqls["userevents"] = "SELECT eid, rsvp_status FROM event_member WHERE uid= " + uid;
			fqls["userfriends"] = "SELECT uid1 FROM friend WHERE uid2 = " + uid;
			fqls["upcomingevents"] = 
				"SELECT eid, name, pic_small, pic_big, pic, start_time, end_time, host, description, location " +
				"FROM event WHERE eid IN (SELECT eid FROM #userevents) AND start_time >" + now;
			fqls['attendance'] = "SELECT eid, uid FROM event_member WHERE eid IN " +
				"(SELECT eid FROM #upcomingevents) AND rsvp_status = '" + fbclient.RSVP_ATTENDING + "'";
			fqls['attname'] = "SELECT name, uid FROM user WHERE uid IN " +
											"(SELECT uid FROM #attendance)";
			fbclient.multifqlCall(
				fqls,
				{access_token: fb_user_token,
				 format:'json',
				},
				function(err, result) {					
					var i, eve, user;					
					var multiadd = rclient.multi();
  
					//store user event list
					rclient.del('usereventslist:'+gtid);
					for(i=0; i<result[0].fql_result_set.length; i++) {
					  eve = result[0].fql_result_set[i];
						multiadd.hset('usereventslist:'+gtid,
							'event:fb:' + eve.eid, eve.rsvp_status
						);
					}
					
 					//store friend list
					for (i=0; i<result[1].fql_result_set.length; i++) {						
						multiadd.sadd('fbfriendslist:'+gtid, result[1].fql_result_set[i].uid1);
					}
					
					//update event time 
					for (i=0; i<result[2].fql_result_set.length; i++) {
						eve = result[2].fql_result_set[i];
						eve.start_time = eve.start_time * 1000; 
						eve.end_time = eve.end_time * 1000;
						eve.id = "fb:" + eve.eid;
						//store event
						multiadd.hmset('event:fb:'+eve.eid, eve);
						//add to event list
						multiadd.sadd('eventslist', 'event:fb:'+eve.eid);
						multiadd.sadd('eventslist:fb', 'event:fb:'+eve.eid);
						//fetch event feeds
						getEventFeed(eve.eid);

					}
								
					//store to attendance
					for (i = 0; i < result[3].fql_result_set.length; i++) {
						eve = result[3].fql_result_set[i];
						multiadd.sadd('attendance:fb:'+eve.eid, eve.uid);
					}							
					
					//store attendee name
					for (i=0; i<result[4].fql_result_set.length; i++) {
						user = result[4].fql_result_set[i];
						multiadd.hmset('fbuser:' + user.uid, user);
					}

					multiadd.exec(function (err, replies) {
						console.log('done fetching');
					});
			});
		});
}

/**
 * Landing Page
 * url:/status/swang308
 * return login status
 */
app.get("/status/:gtid", function (req, res, next) {
	rclient.hget('gtid:fb', req.params.gtid, function (err, fbid) {
		res.send((fbid ?
			{'login_status': 'true'} :
			{'login_status': 'false'}
		));
	})
});


/**
 * Event Feed
 * url:/event/feed/event:fb:179662842054407
 */
app.get('/event/feed/:eid', function (req, res, next) {
	var eid = unescape(req.params.eid).substr(6);
	rclient.smembers("eventfeeds:" + eid, 
		function (error, eventfeeds, body) {
			var multiget = rclient.multi();
			var len = (NUM_FEED > eventfeeds.len ? eventfeeds.len : NUM_FEED);
    	for (i = 0; i < len; i++) {
     		multiget.hgetall('feed:fb:'+eventfeeds[i]);
    	}
    	multiget.exec(function (err, replies) {
      if (!err) {
        res.send(replies);
      }
    });		
	});
});

/**
 * Event Attendance (Total)
 * url:/event/attendance/total/event:fb:12345
 */
app.get('/event/attendance/total/:eid', function (req, res, next) {
	var eid = unescape(req.params.eid).substr(6);
	rclient.smembers("attendance:" + eid, 
		function (error, attendance, body) {
			var multiget = rclient.multi();
    	for (i = 0; i < attendance.length; i++) {
				console.log(attendance[i]);
     		multiget.hgetall('fbuser:' + attendance[i]);
    	}
    	multiget.exec(function (err, replies) {
      if (!err) {
        res.send(replies);
      }
    });		
	});
});


/**
 * Event Attendance (Friend Only)
 * url:/event/attendance/friend/event:fb:12345/swang
 */
app.get('/event/attendance/friend/:eid/:gtid', function (req, res, next) {
	var eid = unescape(req.params.eid).substr(6);
	rclient.sinter("attendance:" + eid, "fbfriendslist:" + req.params.gtid,
			function (error, attendance) {
				var multiget = rclient.multi();
	    	for (i = 0; i < attendance.length; i++) {
					console.log(attendance[i]);
	     		multiget.hgetall('fbuser:' + attendance[i]);
	    	}
	    	multiget.exec(function (err, replies) {
	      if (!err) {
	        res.send(replies);
	      }
	    });		
		});
});

function getEventFeed(eid) {
	fbclient.apiCall(
		'GET',
		'/' + eid + '/feed',
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
					result.data[i].message = result.data[i].message + " " + (result.data[i].description || "");
					result.data[i].actor_id = result.data[i].from.id; //user id
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
					delete result.data[i].comments;
					rclient.sadd('eventfeeds:fb:'+eid, result.data[i].id);
					rclient.del('feed:fb:'+result.data[i].id);
					rclient.hmset('feed:fb:'+result.data[i].id, result.data[i]); 	
        }
		}
		);
}




/**
 * Event Detail
 * url: /event/detail/event:fb:12345/swang308
 */
app.get('/event/detail/:eid/:gtid', function (req, res, next) {
	var eid = unescape(req.params.eid);
	var multiget = rclient.multi();
	console.log(eid);
	multiget.hgetall(eid);
  multiget.hget('usereventslist:'+req.params.gtid, eid);
	multiget.scard('attendance:'+eid.substr(6));
	multiget.sinter('fbfriendslist:' + req.params.gtid, 
								 'attendance:' + eid.substr(6));
  multiget.exec(function (err, result) {	
		result[0].rsvp_status = (result[1] ? result[1] : fbclient.RSVP_NOREPLY);	
		result[0].total_count = result[2];
		result[0].friend_count = result[3].length;
		res.send(result[0]);
	});
});
		

function getEventList(gtid, sort_func, callback) {
	var uid;
	var results = new Array();
	 rclient.hget('gtid:fb', gtid, function (err, res) { 
		 uid = res; 	
		 rclient.smembers("eventslist", function (err, events) {
	     var multiget = rclient.multi();
			 var eve;
			 var size  = (events.length > NUM_LIST_EVENT ? events.length : NUM_LIST_EVENT);
			 for (var i=0; i<events.length; i++) {
			 	 eve = events[i];
			 	 multiget.hgetall(eve);
				 multiget.smembers("attendance:" + eve.substr(6));
				 multiget.sinter('fbfriendslist:' + gtid, 
									 			 'attendance:'  + eve.substr(6));
			 }
			 multiget.exec(function (err, replies) {
			 	 for(var i=0; i<replies.length; ) {
				 	  var event = replies[i++];
						var attendance = replies[i++];
						var friends = replies[i++];
						event.total_count = attendance.length;
						event.friend_count = friends.length;
						event.attendance = attendance.slice(0, NUM_LIST_ATTEND);
						event.friends = friends.slice(0, NUM_LIST_ATTEND);
						results.push(event);
						//magic sort!
					} 
					results = results.sort(sort_func);
	   			return callback(results);
			 })
	  });	
	});
}

/**
 * Event List Sorted by Time
 */
app.get('/event/list/time/:gtid', function(req, res, next) {
	getEventList(req.params.gtid, 
				function (a, b) {return a.start_time - b.start_time;},
				function (result) {
					res.send(result);
				});
});

/**
 * Event List Sorted by Total Attendance
 */
app.get('/event/list/totcount/:gtid', function(req, res, next) {
	getEventList(req.params.gtid, 
			function (a, b) {return b.total_count - a.total_count;},
			function (result) {
				res.send(result);
			});
});

/**
 * Event List Sorted by Friend Attendance
 */
app.get('/event/list/fricount/:gtid', function(req, res, next) {
	getEventList(req.params.gtid, 
			function (a, b) {return b.friend_count - a.friend_count;},
			function (result) {
				res.send(result);
			});
});


/**
 * RSVP Event
 * params: status {attending/declined/maybe}
 * url:/event/rsvp/attending/event:fb:149881618403471/swang308
 * return {response: true/false}
 */
app.get('/event/rsvp/:status/:eid/:gtid', function(req, res, next) {
	rclient.hset('usereventslist:'+req.params.gtid, req.params.eid, req.params.status);
	//update facebook
	rclient.hgetall('user:'+req.params.gtid, 
	 function (err, result) {
	 	 fbclient.rsvpEvent( 
		 	 req.params.eid.substr(9), 
			 result.access_token, 
		   req.params.status, 
			 function(err, response) {
			 	 res.send({'response' : response});
			 })
	});
});


/**
 * Facbook Login Page
 * url:/login/swang308
 */
app.get('/login/:gtid', function (req, res, next) {
  //request permission
  res.redirect(fbclient.getAuthorizeUrl({
    client_id: FBKEY,
    redirect_uri: 'http://' + THISHOST + '/auth/'+req.params.gtid,
    scope:      'offline_access,publish_stream,user_events,friends_events,create_event,rsvp_event'
  }));
});

/**
 * Facebook Authentication
 */
app.get('/auth/:gtid', function (req, res) {
  fbclient.getAccessToken(
    {redirect_uri: 'http://' + THISHOST + '/auth/' + req.params.gtid,
     code: req.param('code')},
     function (error, token) {
			 initUserInfo(req.params.gtid, token.access_token);
       res.redirect('/event/list/time/'+req.params.gtid);
    });
});
  

app.get('/fetchjp', function (req, res, next) {
  request({
    uri: "http://query.yahooapis.com/v1/public/yql?q=use%20%22http%3A%2F%2Fchrisirhc.github.com%2FgtEvents-backend%2Fjacketpages.events.xml%22%3B%20select%20*%20from%20jacketpages.events%3B&format=json"
  },
    function (error, response, body) {
      var bodyObj, i, currId, eve, multi;
      if (!error && response.statusCode == 200) {
        bodyObj = JSON.parse(body);
        events = bodyObj.query.results.events.event;
        multi = rclient.multi();

        for (i = 0; eve = events[i]; i++) {
          eve.eid = eve.id;
					eve.id = 'jp:' + eve.id;
          if (eve.end_time.indexOf(",") == -1) {
            eve.end_time = eve.start_time.split(/, [1-9]/)[0] + ", " + eve.end_time;
          }
          // Insert into database
          multi.hmset('event:jp:'+eve.eid, eve);
          multi.sadd('eventslist', 'event:jp:'+eve.eid);
          multi.sadd('eventslist:jp', 'event:jp:'+eve.eid);
        }

        multi.exec(function (err, replies) {
          if (!err) {
            res.send("Fetched");
          }
        });
      }
    });
});


/** Should make this an atomic command but do it later **/
app.get('/clear', function (req, res, next) {
  //clean up db
	rclient.flushdb(); //for development only
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
