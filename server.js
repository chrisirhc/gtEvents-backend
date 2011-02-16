// Default value for host
var THISHOST = "chrisirhc.no.de";
var DEVELOPMENT_HOST = "gtevents.localhost:3000";
var FBKEY = 'xxxxxxxxxxxxxxx';
var FBSECRET = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
var FBTOKEN = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
var GTEVENTS_PAGEID = 'xxxxxxxxxxxxxxxx';
var DEVELOPMENT_FBKEY = 'xxxxxxxxxxxxxxx';
var DEVELOPMENT_FBSECRET = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
var DEVELOPMENT_TOKEN = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
var DEVELOPMENT_PAGEID = 'xxxxxxxxxxxxxxxx';

/**
 * Constants
 */
var NUM_LIST_EVENT = 20; //number of events shown on list page
var NUM_LIST_ATTEND = 5; //number of attendees shown on list page
var FEED_LIMIT = 99; //number of event feeds
var ATTENDANCE_LIMIT = 99; //number of attendance 
var FB_PAGES = new Array(
	'35150423420', //FerstCenter
	'104374712683', //CRC
	'104804139480', //College of Computing
	'311147925771', //Georgia Institute of Technology Bands 
	'15328653162', //Georgia Tech Athletics
	'105166199515818', //Georgia Tech Office of Success Programs
	'135540189805805', //Georgia Tech Goldfellas
	'107518605955318', //Georgia Tech Student Center
	'59102723065', //Student Center Programs Council
	'8264471191', //Georgia Tech Library
	'363586652173', //Georgia Tech Career Services
	'44851172785', //Georgia Tech Crew
	'245926061925', //AIESEC Georgia Tec
	'85852244494', //Georgia Tech Hockey
	'184109331229', //Georgia Tech College of Management Undergraduate Program
	'179607177694' //Georgia Tech College of Architecture
);

/**
 * This is where it all begins
 */
var sys = require("sys");
var express = require("express");
var request = require("request");
var redis = require("redis"),
  rclient = redis.createClient();

var fbclient = require('./lib/facebook-js');
var Step = require('./lib/step/lib/step.js');

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
  FBTOKEN = DEVELOPMENT_TOKEN;
	GTEVENTS_PAGEID = DEVELOPMENT_PAGEID;
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

function fetchEventInfo(eids, callback) {
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

        Step(function() {
          var group = this.group();
				for (i=0; i<result[0].fql_result_set.length; i++) {
					eve = result[0].fql_result_set[i];
					eve.start_time = eve.start_time * 1000; 
					eve.end_time = eve.end_time * 1000;
					eve.id = "fb:" + eve.eid;

          rclient.hexists('event:fb:jp', 'event:fb:'+eve.eid, (function (eve, multi, groupcb) {
            return function (err, res) {
              if (!res) {
                //store event
                multi.hmset('event:fb:'+eve.eid, eve);
              }
              groupcb();
            }
          })(eve, multiadd, group()));

					//add to event list
					multiadd.sadd('eventslist', 'event:fb:'+eve.eid);
					multiadd.sadd('globaleventslist', 'event:fb:'+eve.eid);
					multiadd.sadd('updatedeventslist', 'event:fb:'+eve.eid);
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
        }, function (err) {

				multiadd.exec(function (err, replies) {
					console.log('done fetching georgia tech events');
          callback && callback();
				});
        });
		});
}
/**
 * Initialize User data
 * @param {Object} facebook user access_token
 */
function initUserInfo(gtid, fb_user_token, callback) {
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
			rclient.hset('userslist', gtid, fb_user_token);
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
						//add to event to global list
						multiadd.sadd('globaleventslist', 'event:fb:'+eve.eid);
						multiadd.sadd('updatedeventslist', 'event:fb:'+eve.eid);
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
						callback();
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
			var len = (FEED_LIMIT > eventfeeds.length ? eventfeeds.length : FEED_LIMIT);
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
			var len = (ATTENDANCE_LIMIT > attendance.length ? attendance.length : ATTENDANCE_LIMIT);
    	for (i = 0; i < len; i++) {
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
				var len = (ATTENDANCE_LIMIT > attendance.length ? attendance.length : ATTENDANCE_LIMIT);
	    	for (i = 0; i < len; i++) {
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
		{'limit': FEED_LIMIT},
		function (error, result) {
			if (error) {
				sys.log("Error: " + sys.inspect(error));
				return;
			}
	   	var multi = rclient.multi();
			 for (var i = 0; i < result.data.length; i++) {
					var date = result.data[i].updated_time;
					var year = date.substr(0, 4);
					var mth = date.substr(5, 2);
					var day = date.substr(8, 2);
					var hour = date.substr(11, 2);
					var min = date.substr(14, 2);
					var sec = date.substr(17, 2);
				  result.data[i].update_time = new Date(year, mth, day, hour, min, sec).getTime();
	
					//http://graph.facebook.com/166803010034186_166992426681911
					//this feed don't give poster name
					//sad, heart broken. :(
					if(!result.data[i].from) {
						result.data[i].name = '--';
						result.data[i].actor_id = GTEVENTS_PAGEID; //user id
					}else {
						result.data[i].name = result.data[i].from.name;
						result.data[i].actor_id = result.data[i].from.id;
					}
					result.data[i].message = result.data[i].message + " " + (result.data[i].description || "");
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
					multi.sadd('eventfeeds:fb:'+eid, result.data[i].id);
					multi.hmset('feed:fb:'+result.data[i].id, result.data[i]); 	
        }
			multi.exec();	
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
	multiget.hgetall(eid);
  multiget.hget('usereventslist:'+req.params.gtid, eid);
	multiget.scard('attendance:'+eid.substr(6));
	multiget.sinter('fbfriendslist:' + req.params.gtid, 
								 'attendance:' + eid.substr(6));
	multiget.scard('eventfeeds:' + eid.substr(6));
  multiget.exec(function (err, result) {	
		result[0].rsvp_status = (result[1] ? result[1] : fbclient.RSVP_NOREPLY);	
		result[0].total_count = result[2];
		result[0].friend_count = result[3].length;
		result[0].feed_count = result[4];
		res.send(result[0]);
	});
});
		

function getEventList(gtid, eventslist, sort_func, callback) {
	var results = new Array();
			
	rclient.smembers(eventslist, function (err, events) {
		var multiget = rclient.multi();
		var eve;
		var size  = (events.length > NUM_LIST_EVENT ? events.length : NUM_LIST_EVENT);
		for (var i=0; i<events.length; i++) {
			eve = events[i];
			multiget.hgetall(eve);
			multiget.smembers("attendance:" + eve.substr(6));
			multiget.sinter('fbfriendslist:' + gtid, 
						 			 'attendance:'  + eve.substr(6));
			multiget.scard('eventfeeds:' + eve.substr(6));
		}
		multiget.exec(function (err, replies) {
			for(var i=0; i<replies.length; ) {
			  var event = replies[i++];
				var attendance = replies[i++];
				var friends = replies[i++];
				event.feed_count = replies[i++];
				event.total_count = attendance.length;
				event.friend_count = friends.length;
				event.attendance = attendance.slice(0, NUM_LIST_ATTEND);
				event.friends = friends.slice(0, NUM_LIST_ATTEND);
				results.push(event);	
			}   			
			//magic sort!
			results = results.sort(sort_func);
			return callback(results);
		})
	});	
}

/**
 * Event List Sorted by Time
 */
app.get('/event/list/time/:gtid', function(req, res, next) {
	getEventList(req.params.gtid, 'eventslist', 
				function (a, b) {return a.start_time - b.start_time;},
				function (result) {
					res.send(result);
				});
});

/**
 * Event List Sorted by Total Attendance
 */
app.get('/event/list/totcount/:gtid', function(req, res, next) {
	getEventList(req.params.gtid, 'globaleventslist',
			function (a, b) {return b.total_count - a.total_count;},
			function (result) {
				res.send(result);
			});
});

/**
 * Event List Sorted by Friend Attendance
 */
app.get('/event/list/fricount/:gtid', function(req, res, next) {
	getEventList(req.params.gtid, 'globaleventslist',
			function (a, b) {return b.friend_count - a.friend_count;},
			function (result) {
				res.send(result);
			});
});

/**
 * Event List Smarted Sorted for each user
 * By: 1. friends 2.time 3.total
 */
app.get('/event/list/smart/:gtid', function(req, res, next) {
	getEventList(req.params.gtid, 'globaleventslist',
			function (a, b) { 
				if (b.friend_count != a.friend_count) {
					 return b.friend_count - a.friend_count;
				}else if (b.start_time != a.start_time) {
					 return a.start_time - b.start_time;
				}else {
					return b.total_count - a.total_count;
				}
			},
			function (result) {
				res.send(result);
			});
});

/**
 * Event List (Invited Only)
 */
app.get('/event/list/invited/:gtid', function(req, res, next) {
	var results = new Array();
			
	rclient.hkeys("usereventslist:" + req.params.gtid, function (err, events) {
		var multiget = rclient.multi();
		var eve;
		var size  = (events.length > NUM_LIST_EVENT ? events.length : NUM_LIST_EVENT);
		for (var i=0; i< size; i++) {
			eve = events[i];
			multiget.hgetall(eve);
			multiget.smembers("attendance:" + eve.substr(6));
			multiget.sinter('fbfriendslist:' + req.params.gtid, 
						 			 'attendance:'  + eve.substr(6));
			multiget.scard('eventfeeds:' + eve.substr(6));
			multiget.hget('usereventslist:' + req.params.gtid, eve);
		}
		multiget.exec(function (err, replies) {
			for(var i=0; i<replies.length; ) {
			  var event = replies[i++];
				var attendance = replies[i++];
				var friends = replies[i++];
				if (! event.id ) {
					rclient.hdel("usereventslist:" + req.params.gtid, eve);
					break; //past events
				}
				event.feed_count = replies[i++];
				event.rsvp_status = replies[i++];
				event.total_count = attendance.length;
				event.friend_count = friends.length;
				event.attendance = attendance.slice(0, NUM_LIST_ATTEND);
				event.friends = friends.slice(0, NUM_LIST_ATTEND);	
				results.push(event);	
			}   			
			//magic sort!
			results = results.sort(function (a, b) {return a.start_time - b.start_time});
			res.send(results);
		})
	});	
});





/**
 * RSVP Event
 * params: status {attending/declined/maybe}
 * url:/event/rsvp/attending/event:fb:149881618403471/swang308
 * return {response: true/false}
 */
app.get('/event/rsvp/:status/:eid/:gtid', function(req, res, next) {
	//update facebook
	rclient.hgetall('user:'+req.params.gtid, 
	 function (err, result) {
	 	 fbclient.rsvpEvent( 
		 	 req.params.eid.substr(9), 
			 result.access_token, 
		   req.params.status, 
			 function(err, response) {
			 	 if(response && response == true) {
						rclient.hset('usereventslist:'+req.params.gtid, req.params.eid, req.params.status);
				 		res.send({'response' : response});
				 }else{
				 		res.send({'response' : 'false'});
				 }
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
			 initUserInfo(req.params.gtid, token.access_token, function () {
			 	  res.redirect('/event/list/time/'+req.params.gtid);
			 });
    });
});
  

app.get('/fetchjp', function (req, res, next) {
  return fetchJP(req, res);
});

function fetchJP(req, res, callback) {
  request({
    uri: "http://query.yahooapis.com/v1/public/yql?q=use%20%22http%3A%2F%2Fchrisirhc.github.com%2FgtEvents-backend%2Fjacketpages.events.xml%22%3B%20select%20*%20from%20jacketpages.events%3B&format=json"
  },
    function (error, response, body) {
      var bodyObj, i, currId, eve, multi;
      if (!error && response.statusCode == 200) {
        bodyObj = JSON.parse(body);
        events = bodyObj.query.results.events.event;
        multi = rclient.multi();

        Step(function () {
          var group = this.group();
        for (i = 0; eve = events[i]; i++) {
          currId = eve.id = 'jp:' + eve.id;

          eve.description = eve.content;
          delete eve.content;

          if (eve.end_time.indexOf(",") == -1) {
            eve.end_time = eve.start_time.split(/, [1-9]/)[0] + ", " + eve.end_time;
          }
					eve.description = (eve.description || '').replace(/\n/gi, ' ');
							
					eve.start_time = new Date(eve.start_time);
					eve.end_time = new Date(eve.end_time);
					if (eve.start_time.getFullYear() < ((new Date()).getFullYear() -2)) {
						eve.start_time.setFullYear((new Date()).getFullYear());
						eve.end_time.setFullYear((new Date()).getFullYear());
					}
					
					eve.start_time = eve.start_time.getTime();
					eve.end_time = eve.end_time.getTime();
				
			
          // We won't really use the info in db but it's there. Probably for updates.
          multi.hmset('event:jp:'+eve.eid, eve);
          multi.sadd('eventslist:jp', 'event:jp:'+eve.eid);

          // Insert into database
          rclient.hget('event:jp:fb','event:jp:' + currId, (
            function (eve, currentId, groupcallback) {
            return function (err, fbId) {
              var fbeve = {};
              // If it doesn't exist, then create it.
              if (!fbId) {

                // Create the Facebook event.
                fbeve.host = eve.host;
                fbeve.name = eve.name;
                fbeve.description = eve.description;
                fbeve.location = eve.location;
                fbeve.start_time = eve.start_time / 1000;
                fbeve.end_time = eve.end_time / 1000;
                fbeve.page_id = GTEVENTS_PAGEID;
                fbeve.category = '1';
                fbeve.subcategory = '1';
                fbeve.city = 'Atlanta';
                fbeve.privacy = 'OPEN';

                fbclient.createEvent(FBTOKEN, fbeve, function (err, res) {
                  if (err) {
                    console.log("Error: " + sys.inspect(err));
                  } else {
                    console.log("Inserted an event " + sys.inspect(res));
                    // insert the id to map over so that we won't reinsert this in fb.
                    multi.hset('event:jp:fb', 'event:jp:' + currentId, 'event:fb:' + res);
                    multi.hset('event:fb:jp', 'event:fb:' + res, 'event:jp:' + currentId);
                    // Use the original event in JacketPages
                    eve.eid = res;
                    multi.hmset('event:fb:' + res, eve);
                  }
                  groupcallback();
                });
              } else {
                // Update/overwrite if it already exists
                console.log("Updated an event : " + fbId);
                eve.eid = fbId.substr(9);
                multi.hmset(fbId, eve);
                groupcallback();
              }
            };
          })(eve, currId, group()));
        }
        }, function (err) {
          multi.exec(function (err, replies) {
            if (!err) {
              res && res.send(sys.inspect(events));
            } else {
              res && res.send("Error occurred");
              console.log(sys.inspect(err));
            }
            // Callback when done.
            callback && callback();
          });
        });
      }
    });
}

/**
 * Manual refreshing of the data on the database
 */
app.get('/refresh', (function () {
  return function (req, res) {
    if (backgroundProcess) {
      refreshStuff();
      res.send("Database is now refreshing.");
    } else {
      res.send("Database is already in the midst of refreshing.");
    }
  };
})());

var TIMERCONST = 10 * 60 * 1000;
var backgroundProcess;

function refreshStuff() {
  backgroundProcess = null;
  Step(function () {
    // Fetch JP Pages
    fetchJP(undefined, undefined, this);
  }, function (err) {
    // Fetch Facebook Events
    var callback = this;
    fetchPageEvent(
      function (result) {
        fetchEventInfo(result, callback);
      }
    );
  }, function (err) {
    // Process all users
    rclient.hgetall('userslist', (function (groupcallback) {
      return function (error, results) {
        var userToken, emptyResults = true;
        for (var userId in results) {
          emptyResults = false;
          userToken = results[userId];
          console.log("processing user " + userId + " " + userToken);
          initUserInfo(userId, userToken, groupcallback());
        }
        if (emptyResults) {
          groupcallback()();
        }
      }
    })(this.group()));
  }, function (err) {
    // Garbage collection
    var multi = rclient.multi();
    var callback = this;

    // Find what's not touched during this update
    multi.sdiffstore("garbageeventslist", "globaleventslist", "updatedeventslist");
    multi.rename("updatedeventslist", "globaleventslist");

    multi.exec(function (error, results) {
      console.log("Results: " + sys.inspect(results));
      // If there is more than one event to trash
      if(results[0]) {
        rclient.smembers("garbageeventslist", function (error, results) {
          console.log("Garbage: " + sys.inspect(results));
          rclient.del(results, callback);
        });
      } else {
        console.log("No garbage.");
        callback();
      }
    });
  }, function (err) {
    sys.log("Another round of background process.");
    backgroundProcess = setTimeout(function () {
      refreshStuff();
    }, TIMERCONST);
  });
};
refreshStuff();

/** Should make this an atomic command but do it later **/
app.get('/clear', function (req, res, next) {
  //clean up db, 
	rclient.flushdb(function (err,result) {
		res.send("Cleaned.");
	}); //for development only
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
