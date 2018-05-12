var mongoose = require('mongoose');
var models = require('./models');
var google = require('googleapis');
var {User, Reminder, Meeting} = require('./models');
var slackID;
var _ = require('underscore')
var axios = require('axios');
const timeZone = "2017-07-17T14:26:36-0700";
const identifier = 20150910;
var OAuth2 = google.auth.OAuth2;
var googleAuth = require('google-auth-library');
var {RtmClient, WebClient, CLIENT_EVENTS, RTM_EVENTS} = require('@slack/client');
//same as var RtmClient = require('@slack/client').RtmClient
var token = process.env.SLACK_API_TOKEN || '';
var rtm = new RtmClient(token);
var web = new WebClient(token);
let channel;
var awaitingResponse = false;
mongoose.Promise = global.Promise;

rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, (rtmStartData) => {
  // console.log(`Logged in as ${rtmStartData.self.name} of team ${rtmStartData.team.name}, but not yet connected to a channel`);
});
rtm.on(RTM_EVENTS.MESSAGE, function handleRtmMessage(message) {

  var dm = rtm.dataStore.getDMByUserId(message.user); //gets the channel ID for the specific conversation between one user and bot
  slackID = message.user;
  const userId = message.user;
  if(message.subtype && message.subtype === 'message_changed') {
     console.log('User has answered interactive message, awaitingResponse set to false- message.subtype is message_changed. Their response was', message);
    awaitingResponse = false;
    return;
  }
  if( !dm || dm.id !== message.channel || message.type !== 'message') {
      console.log('!dm || dm.id !== message.channel || mesage.type !== message is true. printing message and dm', message, dm)//, 'dm: ', dm, ' dm.id: ', dm.id, message.channel, 'message.type',  message.type);
    return;
  }
  User.findOne({slackID: slackID}).exec(function(err, user){
    if(err){
      console.log(err)
    } else {
      if(!user){
        rtm.sendMessage('Please visit the following link to activate your account ' + process.env.DOMAIN + '/oauth?auth_id='+slackID, message.channel);
      } else {
          processMessage(message, rtm, user);
      }
    }
  })
});
rtm.on(RTM_EVENTS.REACTION_ADDED, function handleRtmReactionAdded(reaction) {
  console.log('Reaction added:', reaction);
});
rtm.on(RTM_EVENTS.REACTION_REMOVED, function handleRtmReactionRemoved(reaction) {
  console.log('Reaction removed:', reaction);
});
rtm.start();

function processMessage(message, rtm, sender) {
  axios.get('https://api.api.ai/api/query', {
    params: {
      v: identifier,
      lang: 'en',
      timezone: timeZone,
      query: message.text,
      sessionId: message.user
    },
    headers: {
      Authorization: `Bearer ${process.env.API_ACCESS_TOKEN}`
    }
  })
  .then(function({data}) {
    if(awaitingResponse) {
      rtm.sendMessage('Please accept or decline the previous reminder', message.channel);
    }
    else if(data.result.actionIncomplete) {
      rtm.sendMessage(data.result.fulfillment.speech, message.channel)
    } else if(Object.keys(data.result.parameters).length !== 0){

      if(data.result.metadata.intentName === "Setting a Reminder"){
        //remind intent
        awaitingResponse = true;
        web.chat.postMessage(message.channel, `Would you like me to create a reminder for ` , {
          "attachments": [
            {
              "fields": [
                {
                  "title": "Subject",
                  "value": `${data.result.parameters.subject}`
                },
                {
                  "title": "Date",
                  "value": `${data.result.parameters.date}`
                }
              ],
              "fallback": "You are unable to choose a game",
              "callback_id": "wopr_game",
              "color": "#3AA3E3",
              "attachment_type": "default",
              "actions": [
                {
                  "name": "yes",
                  "text": "Confirm",
                  "type": "button",
                  "value": "true"
                },
                {
                  "name": "no",
                  "text": "Cancel",
                  "type": "button",
                  "value": "false"
                }
              ]
            }
          ]
        });
    } else if(data.result.metadata.intentName === 'meeting.add'){
        //it is the meeting intent
        let inviteArr = [];
        var i = 0;
        data.result.parameters.invitees.forEach((user) => {
          if(user.length > 1){
            if(user.charAt(0) === "<"){
              var newUser = user.substr(2)
            } else {
              var newUser = user.substr(1)
            }
            // console.log(' new user is ', newUser)
            let userObj = rtm.dataStore.getUserById(newUser)
            if(userObj){
                inviteArr.push(userObj.name)

            } else {
                console.log('no user found with id ', newUser);
                throw new Error(`Unable to find slack user: ${newUser}`)
            }


          }
        })
        var newMeeting = new Meeting({
            userID: sender._id,//'596f927c2945b10011ad86b0',
            channelID: message.channel,
            subject: data.result.parameters.subject[0],
            date: data.result.parameters.date,
            time: data.result.parameters.time,
            invitees: inviteArr,
        })

        var fields = [
          {
            "title": "Subject",
            "value": `${newMeeting.subject}`
          },
          {
            "title": "Invitees",
            "value": `${newMeeting.invitees}`
          }
        ];
        var duration;
        if(data.result.parameters.duration !== "") {
            duration = {"title": "Duration", "value": `${data.result.parameters.duration.amount} ${data.result.parameters.duration.unit}`}
        }
        checkConflicts(newMeeting, rtm)
        .then((freeTimeList)=>{
            if(freeTimeList && freeTimeList.length === 0){
                fields.push({"title": "Date", "value": `${newMeeting.date}`})
                fields.push({"title": "Time", "value": `${newMeeting.time}`})
                if(duration) { fields.push(duration)}
                awaitingResponse = true;
                web.chat.postMessage(message.channel, `Would you like me to create the following meeting: ` , {
                  "attachments": [
                    {
                      "fields": fields,
                      "callback_id": "wopr_game",
                      "color": "#3AA3E3",
                      "attachment_type": "default",
                      "actions": [
                        {
                          "name": "yes",
                          "text": "Confirm",
                          "type": "button",
                          "value": "true"
                        },
                        {
                          "name": "no",
                          "text": "Cancel",
                          "type": "button",
                          "value": "false"
                        }
                      ]
                    }
                  ]
                });

            } else {
                if(duration) { fields.push(duration)}
                var options = []

                freeTimeList.forEach((time)=> {
                    var startTime = new Date(time.start)
                    var endTime = new Date(time.end)
                    var newStartTime = new Date(startTime.toDateString() + ' ' + startTime.toTimeString() + "+07:00").toLocaleString()
                    var newEndTime = new Date(endTime.toDateString() + ' ' + endTime.toTimeString() + "+07:00").toLocaleString().split(',')
                    options.push({"text": `${newStartTime}-${newEndTime[1]}`, "value": time.start})
                })
                console.log('FREELIST IS', freeTimeList);
                console.log('OPTIONS IS', options);
                awaitingResponse = true;
                web.chat.postMessage(message.channel, 'Sorry! There was a scheduling conflict with your requested meeting time!', {
                    "response_type": "in_channel",
                    "attachments": [
                        {
                            "text": "Please select a new meeting time from the list.",
                            "fields": fields,
                            "fallback": "If you could read this message, you'd be choosing something fun to do right now.",
                            "color": "#3AA3E3",
                            "attachment_type": "default",
                            "callback_id": "game_selection",
                            "actions": [
                                {
                                    "name": "games_list",
                                    "text": "Select a new meeting time...",
                                    "type": "select",
                                    "options": options
                                },
                                {
                                    "name": "no",
                                    "text": "Cancel",
                                    "type": "button",
                                    "value": "false"
                                }

                            ]
                        }
                    ]
                })

            }
        }).catch((err) => {
            rtm.sendMessage(`Sorry there was an error with that request. ${err}`, message.channel);
            console.log('CHECKCONFLCITS PROMISE ERROR: error with checkconflicts', err);
            // rtm.sendMessage
        })
      }
    }
    else {
      rtm.sendMessage(data.result.fulfillment.speech, message.channel)
    }
  })
  .catch(function(err){
    console.log('error in procesmessage', err);
    rtm.sendMessage(`Sorry there was an error with that request. ${err}`, message.channel);
  })
}



function checkConflicts(meeting, rtm){
    console.log('inside check conflcits and the meeting is ', meeting);
    var busySlots = [];
    var count = 0;
    var conflictExists = false;
    var counterGoal = meeting.invitees.length;
    var invitee, user,sevenBusinessDays, meetingDate;
    return new Promise((resolve, reject) => {
        meeting.invitees.forEach( function(meetinginvitee) {
            invitee = meetinginvitee;
            var inviteeuser = rtm.dataStore.getUserByName(invitee); //given the invitee slack name, find their slack user object
            if(!inviteeuser) {
                // console.log('CHECKCONFLICTS: user not found with that name', invitee);
                // reject('err')
                console.log(`Couldnt find slack user with name ${invitee}.`);
                // rtm.sendMessage(`user not found with name ${invitee}`, meeting.channelID);
                reject(`Couldnt find slack user with name ${invitee}.`)
                // throw new Error(`Couldnt find slack user ${invitee}.`);
            } else {
                var inviteeSlackID = inviteeuser.id;
                User.findOne({slackID: inviteeSlackID}).exec()
                .then((user) =>{
                    if(user) {
                        user = user;
                        //save user tokens
                        var tokens = user.token;
                        oauth2Client = new OAuth2(
                            process.env.GOOGLE_CLIENT_ID,
                            process.env.GOOGLE_CLIENT_SECRET,
                            process.env.DOMAIN + '/connect/callback'
                        )
                        oauth2Client.setCredentials(tokens);
                        var calendar = google.calendar('v3');
                        //AT THIS POINT YOU ARE AUTHENTICATED TO SEE THE INVITEE GOOGLE calendar
                        console.log("DATE: ",meeting.date, "TIME: ", meeting.time);
                        meetingDate = new Date(meeting.date + ' ' + meeting.time + "-07:00");
                        console.log("MEETING:", meetingDate);
                        console.log("MEETING ISO", meetingDate.toISOString());
                        console.log("ALT", new Date(meeting.date + ' ' + meeting.time))
                        console.log("ALTISO", new Date(meeting.date + ' ' + meeting.time).toISOString());
                        var meetingEnd = new Date(meeting.date + ' ' + meeting.time + "-07:00");
                        meetingEnd.setMinutes(meetingEnd.getMinutes() + meeting.duration);
                        var n = 7;
                        while (workingDaysBetweenDates(meetingDate.toString(), new Date(Date.parse(meetingEnd) + n*24*60*60*1000)) < 7){
                            n++;
                        }
                        sevenBusinessDays = new Date(Date.parse(meetingEnd) + n*24*60*60*1000)
                        console.log("BEFORE PROMISE", meetingDate);
                        return new Promise((resolve, reject) => {
                            calendar.freebusy.query({
                                auth: oauth2Client,
                                headers: { "content-type" : "application/json" },
                                resource:{
                                    items: [{id: 'primary', busy: 'Active'}],
                                    timeMin: meetingDate.toISOString(),
                                    timeMax: sevenBusinessDays.toISOString() //first # controls # of days to check for conflicting events
                                }
                            }, function(err, schedule) {
                                // console.log(typeof schedule);
                                if(schedule){
                                    resolve(schedule)
                                } else {
                                    console.log('REJECTING PROMISE', err);
                                    reject(err);
                                }
                            }
                        )
                    })
                } else {
                    // rtm.sendMessage(`I do not have the correct permissions invite ${invitee} to this meeting.`, meeting.channelID);
                    // throw new Error('couldnt find user');
                    throw new Error(`There was an error scheduling a meeting with ${invitee}. I may not have the correct permissions. Tell them to message me!`);
                }
            })
            .then((schedule) => {
                // console.log('scheudle was retunred', schedule);
                console.log("AFTER PROMISE", meetingDate);
                if(false && !schedule){
                    console.log(`rejectig: I was not able to locate ${invitee}'s schedule to create the meeting.`);
                    reject(`I was not able to locate ${invitee}'s schedule to create the meeting.`)
                    // throw new Error(`I was not able to locate ${invitee}'s schedule to create the meeting.`);
                }else {
                    // console.log('schedule is ', schedule);
                    var busyList = schedule.calendars.primary.busy;
                    busySlots = busySlots.concat(busyList);
                    console.log("BUSYLIST", busyList)
                    // console.log(invitee);
                    busyList.forEach((time) => {
                        var meetingStartTime = new Date(meeting.date + ' ' + meeting.time + "-07:00");;
                        meetingStartTime.setDate(meetingStartTime.getDate());
                        var meetingEndTime = new Date(meeting.date + ' ' + meeting.time + "-07:00");
                        meetingEndTime.setDate(meetingEndTime.getDate());
                        meetingEndTime.setMinutes(meetingEndTime.getMinutes() + meeting.duration);
                        var conflictStartTime = new Date(time.start);
                        // conflictStartTime.setDate(conflictStartTime.getDate());
                        var conflictEndTime = new Date(time.end);
                        // conflictEndTime.setDate(conflictEndTime.getDate());
                        var convertedMeetingStartTime = new Date(meetingStartTime.toDateString() + ' ' + meetingStartTime.toTimeString() + "+07:00").toLocaleString();
                        var convertedMeetingEndTime = new Date(meetingEndTime.toDateString() + ' ' + meetingEndTime.toTimeString() + "+07:00").toLocaleString();
                        var convertedConflictStartTime = new Date(conflictStartTime.toDateString() + ' ' + conflictStartTime.toTimeString() + "+07:00").toLocaleString();
                        var convertedConflictEndTime = new Date(conflictEndTime.toDateString() + ' ' + conflictEndTime.toTimeString() + "+07:00").toLocaleString();
                        if((meetingStartTime <= conflictStartTime && meetingEndTime > conflictStartTime) || (meetingStartTime >= conflictStartTime && meetingStartTime <= conflictEndTime)){
                            //console.log('BUSY: The meeting time \n', convertedMeetingStartTime, ' - ', convertedMeetingEndTime, '\n conflicts with user event at \n', convertedConflictStartTime, ' - ', convertedConflictEndTime, '\n');
                            conflictExists = true;
                        } else {
                            //console.log(meetingEndTime >= conflictStartTime && meetingEndTime <= conflictEndTime);
                            //console.log('FREE: No overlap between meeting at \n',convertedMeetingStartTime, ' - ', convertedMeetingEndTime, '\n and the users event at \n', convertedConflictStartTime, ' - ', convertedConflictEndTime, '\n');
                        }
                    })
                }
                return;
            })
            .then( () => {
                count+=1
                if(count === counterGoal){
                    var freetimelist = findFreeTimes(busySlots, meetingDate.toISOString(), sevenBusinessDays.toISOString(), meeting.duration);
                    // console.log('freetimelist', freetimelist);
                    if(conflictExists) {
                        resolve(freetimelist);
                    } else {
                        resolve([]);
                    }
                }
            })
            .catch((err) => {
                counterGoal -= 1; //if you cant get a user, subtract from counter goal so your not waiting on a users info that will never come
                console.log('rejecting  promises in catch, decrementing counterGoal', err);
                reject(err);
            })
        }
    }) //end of for each
})
}

function workingDaysBetweenDates(startOfMeeting, endDate) {
  // Validate input

  var startDate = new Date(startOfMeeting);

  if (endDate < startDate)
  return 0;

  // Calculate days between dates
  var millisecondsPerDay = 86400 * 1000; // Day in milliseconds
  startDate.setHours(0,0,0,1);  // Start just after midnight
  endDate.setHours(23,59,59,999);  // End just before midnight
  var diff = endDate - startDate;  // Milliseconds between datetime objects
  var days = Math.ceil(diff / millisecondsPerDay);

  // Subtract two weekend days for every week in between
  var weeks = Math.floor(days / 7);
  days = days - (weeks * 2);

  // Handle special cases
  var startDay = startDate.getDay();
  var endDay = endDate.getDay();

  // Remove weekend not previously removed.
  if (startDay - endDay > 1)
  days = days - 2;

  // Remove start day if span starts on Sunday but ends before Saturday
  if (startDay == 0 && endDay != 6)
  days = days - 1

  // Remove end day if span ends on Saturday but starts after Sunday
  if (endDay == 6 && startDay != 0)
  days = days - 1

  return days;
}

function reduceTimeIntervals(busyArray){
    var intervalStack = [];
    //sort the intervals based on increasing order of starting time
    var sortedIntervals = _.sortBy(busyArray, 'start');
    intervalStack.push(sortedIntervals[0]); //push the first interval on stack
    sortedIntervals.forEach( (interval) => {
        var stackTop = intervalStack[intervalStack.length - 1];
        //If the current interval overlaps with stack top and ending
        //        time of current interval is more than that of stack top,
        //        update stack top with the ending  time of current interval.
        if((Date.parse(interval.start) <= Date.parse(stackTop.start)&& Date.parse(interval.end) > Date.parse(stackTop.start)) || (Date.parse(interval.start) >= Date.parse(stackTop.start) && Date.parse(interval.start) <= Date.parse(stackTop.end))){
            if(Date.parse(interval.end) > Date.parse(stackTop.end)){
                var modifiedStackTop = Object.assign({}, intervalStack.pop(), {end: interval.end})
                intervalStack.push(modifiedStackTop);
            }
        } else {
            //if for some reason the busy interval has same start and end time, dont add it
            if(Date.parse(interval.start) !== Date.parse(interval.end)){
                intervalStack.push(interval);
            }

        }
    })
    return intervalStack;
}

function findFreeTimes(busyArray, meetingStartDate, sevenBusinessDays, meetingDuration){
    //meetingStartDate and sevenBusinessDays must be in format '2017-07-22T23:59:59Z'
    console.log(meetingStartDate);
    console.log(sevenBusinessDays);
    var intervals = reduceTimeIntervals(busyArray);
    var freeStart = meetingStartDate//.slice(0,11)+'00:00:00Z' //TODO: CHANGE TO BE 9AM ON THE DAY YOU REQUESTED THE MEETING OR DATE.NOW
    var freeEnd = sevenBusinessDays.slice(0,11)+'06:59:59Z'
    var freeStack = []
    counter = 1;
    var duration = meetingDuration * 60 * 1000; //meeting duration in milliseconds
    var previousDate = (new Date(meetingStartDate)).setDate(new Date(meetingStartDate).getDate()-1)
    console.log("Initial Prev", previousDate);
    intervals.forEach((interval) => {
        var currentFreeTime = Date.parse(freeStart);
        var nextBusyTime = Date.parse(interval.start);


        if(currentFreeTime !== nextBusyTime){
            while(currentFreeTime + duration <= nextBusyTime) {
                currentFreeTime = currentFreeTime + duration;
                // console.log("First compare", new Date(new Date(previousDate).toISOString().substring(0,19)+"+07:00").getDate() ,
                // new Date(new Date(currentFreeTime).toISOString().substring(0,19)+"+07:00").getDate(),
                // new Date(new Date(previousDate).toISOString().substring(0,19)+"+07:00").getDate() != new Date(new Date(currentFreeTime).toISOString().substring(0,19)+"+07:00").getDate());

                if (new Date(new Date(previousDate).toISOString().substring(0,19)+"+07:00").getDate() != new Date(new Date(currentFreeTime).toISOString().substring(0,19)+"+07:00").getDate()){
                    counter = 0;
                }
                if (counter < 3 ){
                    console.log("Adding to freestack");
                    freeStack.push({start: freeStart, end: new Date(currentFreeTime).toISOString()})
                    counter++;
                }
                freeStart = new Date(currentFreeTime).toISOString();
                previousDate = currentFreeTime;
            }
        }
        freeStart = interval.end;
    })
    freeStack.push({start: freeStart, end: freeEnd})

    //make sure you only provide 30 minute/duration selected_options
    //max 3 meetings offered per day

    return freeStack.slice(0,10);
}



module.exports = {
  rtm : rtm,
  web: web
}
