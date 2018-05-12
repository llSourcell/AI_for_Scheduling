var logger = require('morgan');
var google = require('googleapis');
var {User, Reminder, Meeting} = require('./models')
var OAuth2 = google.auth.OAuth2;
var mongoose = require('mongoose');
var _ = require('underscore');
var models = require('./models');
var googleAuth = require('google-auth-library');
var fs = require('fs');
var slackID;
var url;
var {rtm, web} = require('./rtm-client')

mongoose.connect(process.env.MONGODB_URI);
mongoose.Promise = global.Promise;
// var googleAuth = require('google-auth-library');
var express = require('express');
require('./rtm-client');
var app = express();
var bodyParser = require('body-parser');
app.use(logger('dev'));
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
// var app = express();
var {RtmClient, WebClient, CLIENT_EVENTS, RTM_EVENTS} = require('@slack/client');
var CLIENT_ID = process.env.CLIENT_ID;
var CLIENT_SECRET = process.env.CLIENT_SECRET;
const PORT=3000;
app.get('/oauth', function(req, res){
    oauth2Client = new OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.DOMAIN + '/connect/callback'
    )
    url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/userinfo.profile',
            'email',
            'https://www.googleapis.com/auth/calendar'
        ],
        state: encodeURIComponent(JSON.stringify({
            auth_id: req.query.auth_id
        }))
    });
    slackID = req.query.auth_id
    res.redirect(url);
})


// ASYNC SHIT NEED NODE 7 OR 8
// app.get(
//     '/connectcallback', async function(req,res) {
//         var tokens = await getToken(req.query.code)
//         var mongoUser = await User.findById(wejf)
//     }
// )

app.get('/connect/callback', function(req, res) {
    const code = req.query.code;
    oauth2Client = new OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.DOMAIN + '/connect/callback'
    )
    console.log("this is oauth", oauth2Client);
    oauth2Client.getToken(code, function (err, tokens) {
        if(err) {
            console.log(err)
        } else {
            //set credentials. not entirely sure what this does but necessary for google plus
            //when a person gives access to their google calendar, we also make a request to google plus
            //with their oauth2client in order to get their email address which is then saved in the user object
            //in mongodb.
            oauth2Client.setCredentials(tokens);
            console.log("this is tokens", tokens);
            var plus = google.plus('v1');
            plus.people.get({auth: oauth2Client, userId: 'me'}, function(err, person){
                if(err){
                    console.log(err)
                } else {
                    //when a person
                    console.log("this is googleplus person object", person);
                    var tempEmail = person.emails[0].value;
                    let auth_id = JSON.parse(decodeURIComponent(req.query.state));
                    var newUser = new User({
                        token: tokens,
                        slackID: slackID, //TODO: ALSO store slackname so that you can easily add your own meetings to your calendars too
                        auth_id: auth_id.auth_id,
                        email: tempEmail,
                        pendingInvites: []
                    });
                    newUser.save()
                    .then( () => res.status(200).send("Your account was successfuly authenticated"))
                    .catch((err) => {
                        console.log('error in newuser save of connectcallback');
                        res.status(400).json({error:err});
                    })
                }
            });
        }
    });
})
// This route handles GET requests to our root ngrok address and responds with the same "Ngrok is working message" we used before
app.get('/', function(req, res) {
    res.send('Ngrok is working! Path Hit: ' + req.url);
});
// Route the endpoint that our slash command will point to and send back a simple response to indicate that ngrok is working
app.post('/command', function(req, res) {
    res.send('Your ngrok tunnel is up and running!');
});

app.post('/slack/interactive', function(req,res){
    var payload = JSON.parse(req.body.payload);
    console.log('PAYLOAD ACTIONS', payload);
    //if the user selects confirm button
    if(payload.actions[0].value !== 'false') {
        // else if(payload.actions[0].type === "button" && payload.actions[0].value !== 'false') {
        slackID = payload.user.id;
        User.findOne({slackID: slackID}).exec(function(err, user){
            if(err || !user){
                console.log(err);
                res.send('an error occured');
            } else if (user){

                var payloadArr = payload.original_message.attachments;

                if(payload.original_message.text === "Would you like me to create a reminder for "){
                    //it was a reminder
                    console.log('reminder message payload', payload.original_message.attachments[0]);
                    var reminderSubject = payload.original_message.attachments[0].fields[0].value;
                    var reminderDate = Date.parse(payload.original_message.attachments[0].fields[1].value);
                    console.log('rEMINDER DATE IS ', reminderDate, payload.original_message.attachments[0].fields[1].value);
                }
                else{
                    var meetingDuration = 30; //default meeting duration is 1 hour
                    console.log('meeting duration after some stuff idk what its doing ', meetingDuration);
                    var meetingSubject = payload.original_message.attachments[0].fields[0].value;
                    var meetingInvitees = payload.original_message.attachments[0].fields[1].value.split(",");
                    if(payload.actions[0].type === "select"){ //meeting with conflicts with select list
                        var newSplit = payload.actions[0].selected_options[0].value.split('T')
                        var converted = new Date(newSplit[0] + 'T' + newSplit[1].substring(0,newSplit[1].length-1)+ "+07:00").toISOString();
                        var meetingTime = converted.slice(11,19);
                        var meetingDate = converted.slice(0,10)
                        if(payloadArr[0].fields[2]) {
                            console.log('meeting duration field was ', payloadArr[0].fields[2]);
                            //the duration field was provided
                            let durArr = payloadArr[0].fields[2].value.split(" ");
                            if(durArr[1] === "h") {
                                meetingDuration = durArr[0] * 60;
                            } else {
                                meetingDuration = durArr[0]
                            }
                        }
                    }
                    else { //it was a meeting that had no conflicts
                        var meetingDate = payload.original_message.attachments[0].fields[2].value;
                        var meetingTime = payload.original_message.attachments[0].fields[3].value;
                        if(payloadArr[0].fields[4]) {
                            console.log('meeting duration field was ', payloadArr[0].fields[4]);
                            //the duration field was provided
                            let durArr = payloadArr[0].fields[4].value.split(" ");
                            if(durArr[1] === "h") {
                                meetingDuration = durArr[0] * 60;
                            } else {
                                meetingDuration = durArr[0]
                            }
                        }
                    }
                }

                oauth2Client = new OAuth2(
                    process.env.GOOGLE_CLIENT_ID,
                    process.env.GOOGLE_CLIENT_SECRET,
                    process.env.DOMAIN + '/connect/callback'
                )
                oauth2Client.setCredentials({
                    refresh_token: user.token.refresh_token
                });
                oauth2Client.refreshAccessToken(function(err, tokens) {
                    user.token = tokens;
                    user.save()
                    .then((user)=>{
                        if(payload.original_message.text === "Would you like me to create a reminder for "){
                            //it was a reminder
                            var newReminder = new Reminder({
                                userID: user._id,
                                channelID: payload.channel.id,
                                subject: reminderSubject,
                                date: reminderDate,
                            })
                            newReminder.save(function(err){
                                if (err){
                                    res.status(400).json({error:err});
                                }else{
                                    reminderDate = new Date(reminderDate);
                                    createCalendarReminder(reminderDate.toISOString().substring(0, 10), reminderSubject, user.token);
                                    res.send('Reminder Confirmed');
                                }
                            })
                        } else {
                            //it was a meeting
                            var newMeeting = new Meeting({
                                userID: user._id,
                                channelID: payload.channel.id,
                                subject: meetingSubject,
                                date: meetingDate,
                                time: meetingTime,
                                invitees: meetingInvitees,
                                duration: meetingDuration,
                            })
                            newMeeting.save(function(err, meeting){
                                if (err){
                                    res.send('Error saving meeting');
                                }else{
                                    //TODO: instead of first finding the requestors slackname, correctly save it in their mongo object so u dont need to do  find (since inside find email function you need the user not just the name, so pretty uncesssary to do a find name here)
                                    //meetingInvitees.concat([user.slackName])
                                    let requester = rtm.dataStore.getUserById(user._id);
                                    if(requester) {

                                        findAndReturnEmails(meetingInvitees.concat([requester.name]), meetingDate,  meetingSubject, user.token, meetingTime, meeting.duration);
                                    } else { //if for some reason we cant retrieve the infromation about the requestor
                                        console.log('couldnt get information about the user requesting the meeting');
                                        findAndReturnEmails(meetingInvitees, meetingDate,  meetingSubject, user.token, meetingTime, meeting.duration);
                                    }
                                    res.send('Meeting confirmed');
                                }
                            })
                        }
                    })
                });
            }
        })
    } else {
        res.send('Cancelled');
    }
})
app.listen(process.env.PORT || 3000);

function createCalendarReminder(date, subject, tokens, invitees, time, duration){
    if(!invitees){
        let dateTime = date + "T" + time + "-07:00"
        var event = {
            'summary': subject,
            'start': {
                'date': date,//Time,
            },
            'end': {
                'date': date,//Time
            }
        };
    } else {
        let attendeesArr = [];
        invitees.forEach((invited) => {
            attendeesArr.push({
                'email' : invited
            })
        })
        let dateTime = date + "T" + time + "-07:00"

        var endTime = new Date(dateTime);
        endTime.setMinutes(endTime.getMinutes() + parseInt(duration))
        let finalDate = new Date(Date.parse(endTime))

        var event = {
            'summary': subject,
            'start': {
                'dateTime': dateTime
            },
            'end': {
                'dateTime': finalDate,
            },
            'attendees': attendeesArr,
        };
    }

    oauth2Client = new OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.DOMAIN + '/connect/callback'
    )
    oauth2Client.setCredentials(tokens);
    var calendar = google.calendar('v3');
    calendar.events.insert({
        auth: oauth2Client,
        calendarId: 'primary',
        resource: event,
    }, function(err, event) {
        if(err){
            console.log("There was an error adding the calendar", err);
            return
        }else {
            console.log('event created')
        }
    })
}


function findAndReturnEmails (users, date, subject, tokens, time, duration) {

    var slackIdArray = [];

    users.forEach((username) => {
        let userObj = rtm.dataStore.getUserByName(username);
        slackIdArray.push(userObj.id);
    })

    var emailArray = [];
    var promisArray = [];

    slackIdArray.forEach((slackId) => {
        promisArray.push(User.findOne({slackID: slackId}).exec()
        .then((user) => user.email))
    })

    Promise.all(promisArray).then((arr) => {
        if(arr) {
            createCalendarReminder(date, subject, tokens, arr, time, duration);
        } else {
            //idk when this happened but it did once
            console.log('in find and return emails, invitees came to be falsy so not calling createCalendarReminder', arr);
        }
    })
}


//
// function checkConflicts(meeting, rtm){
//     var busySlots = [];
//     var count = 0;
//     var conflictExists = false;
//     var counterGoal = meeting.invitees.length;
//     var invitee, user,sevenBusinessDays, meetingDate;
//     return new Promise((resolve, reject) => {
//     meeting.invitees.forEach( function(invitee) {
//         invitee = invitee;
//         var inviteeuser = rtm.dataStore.getUserByName(invitee); //given the invitee slack name, find their slack user object
//         var inviteeSlackID = inviteeuser.id; //get slack id from slack user
//         //find a user in our DB with that slack username
//         User.findOne({slackID: inviteeSlackID}).exec()
//         .then((user) =>{
//             if(user) {
//                 user = user;
//                 //save user tokens
//                 var tokens = user.token;
//                 oauth2Client = new OAuth2(
//                     process.env.GOOGLE_CLIENT_ID,
//                     process.env.GOOGLE_CLIENT_SECRET,
//                     process.env.DOMAIN + '/connect/callback'
//                 )
//                 oauth2Client.setCredentials(tokens);
//                 var calendar = google.calendar('v3');
//                 //AT THIS POINT YOU ARE AUTHENTICATED TO SEE THE INVITEE GOOGLE calendar
//                 meetingDate = new Date(meeting.date + ' ' + meeting.time + "-07:00");
//                 var meetingEnd = new Date(meeting.date + ' ' + meeting.time + "-07:00");
//                 meetingEnd.setMinutes(meetingEnd.getMinutes() + 30);
//                 var n = 7;
//                 while (workingDaysBetweenDates(meetingDate, new Date(Date.parse(meetingEnd) + n*24*60*60*1000)) < 7){
//                     n++;
//                 }
//                 sevenBusinessDays = new Date(Date.parse(meetingEnd) + n*24*60*60*1000)
//                 return new Promise((resolve, reject) => {
//                     calendar.freebusy.query({
//                     auth: oauth2Client,
//                     headers: { "content-type" : "application/json" },
//                     resource:{
//                         items: [{id: 'primary', busy: 'Active'}],
//                         timeMin: meetingDate.toISOString(),
//                         timeMax: sevenBusinessDays.toISOString() //first # controls # of days to check for conflicting events
//                     }
//                 }, function(err, schedule) {
//                     // console.log(typeof schedule);
//                     if(schedule){
//                         console.log('returning schedule to next then');
//                         resolve(schedule)
//                     } else {
//                         console.log('INSIDE ELSE');
//                         reject(err);
//                         // console.log("There was an error getting invitee calendar", err);
//                         // throw new Error('couldnt find scheduke for user');
//                     }
//                 }
//             )
//         })
//             } else {
//                 throw new Error('couldnt find user');
//             }
//         })
//         .then((schedule) => {
//             // console.log('scheudle was retunred', schedule);
//             if(false && !schedule){
//                 console.log("schedule wasnt returned");
//                 throw new Error('no schedule returns');
//             }else {
//                 // console.log('schedule is ', schedule);
//                 var busyList = schedule.calendars.primary.busy;
//                 busySlots = busySlots.concat(busyList);
//                 console.log(invitee);
//                 busyList.forEach((time) => {
//                     var meetingStartTime = new Date(meeting.date + ' ' + meeting.time + "-07:00");;
//                     meetingStartTime.setDate(meetingStartTime.getDate());
//                     var meetingEndTime = new Date(meeting.date + ' ' + meeting.time + "-07:00");
//                     meetingEndTime.setDate(meetingEndTime.getDate());
//                     meetingEndTime.setMinutes(meetingEndTime.getMinutes() + 30);
//                     var conflictStartTime = new Date(time.start);
//                     // conflictStartTime.setDate(conflictStartTime.getDate());
//                     var conflictEndTime = new Date(time.end);
//                     // conflictEndTime.setDate(conflictEndTime.getDate());
//                     var convertedMeetingStartTime = new Date(meetingStartTime.toDateString() + ' ' + meetingStartTime.toTimeString() + "+07:00").toLocaleString();
//                     var convertedMeetingEndTime = new Date(meetingEndTime.toDateString() + ' ' + meetingEndTime.toTimeString() + "+07:00").toLocaleString();
//                     var convertedConflictStartTime = new Date(conflictStartTime.toDateString() + ' ' + conflictStartTime.toTimeString() + "+07:00").toLocaleString();
//                     var convertedConflictEndTime = new Date(conflictEndTime.toDateString() + ' ' + conflictEndTime.toTimeString() + "+07:00").toLocaleString();
//                     if((meetingStartTime <= conflictStartTime && meetingEndTime > conflictStartTime) || (meetingStartTime >= conflictStartTime && meetingStartTime <= conflictEndTime)){
//                         console.log('BUSY: The meeting time \n', convertedMeetingStartTime, ' - ', convertedMeetingEndTime, '\n conflicts with user event at \n', convertedConflictStartTime, ' - ', convertedConflictEndTime, '\n');
//                         conflictExists = true;
//                     } else {
//                         console.log(meetingEndTime >= conflictStartTime && meetingEndTime <= conflictEndTime);
//                         console.log('FREE: No overlap between meeting at \n',convertedMeetingStartTime, ' - ', convertedMeetingEndTime, '\n and the users event at \n', convertedConflictStartTime, ' - ', convertedConflictEndTime, '\n');
//                     }
//                 })
//             }
//             return;
//         })
//         .then( () => {
//             count+=1
//             if(count === counterGoal){
//                 var freetimelist = findFreeTimes(busySlots, meetingDate.toISOString(), sevenBusinessDays.toISOString());
//                 // console.log('freetimelist', freetimelist);
//                 if(conflictExists) {
//                     console.log('conflcit exists reutrning free times list');
//                      resolve(freetimelist);
//                 } else {
//                     console.log('no conflcit exists not returning ');
//                     resolve([]);
//                 }
//                 // return freetimelist;
//             }
//         })
//         .catch((err) => {
//             counterGoal -= 1; //if you cant get a user, subtract from counter goal so your not waiting on a users info that will never come
//             reject(err);
//         })
//     })
//   }) //end of for each
// }
//
// function workingDaysBetweenDates(startDate, endDate) {
//   // Validate input
//   if (endDate < startDate)
//   return 0;
//
//   // Calculate days between dates
//   var millisecondsPerDay = 86400 * 1000; // Day in milliseconds
//   startDate.setHours(0,0,0,1);  // Start just after midnight
//   endDate.setHours(23,59,59,999);  // End just before midnight
//   var diff = endDate - startDate;  // Milliseconds between datetime objects
//   var days = Math.ceil(diff / millisecondsPerDay);
//
//   // Subtract two weekend days for every week in between
//   var weeks = Math.floor(days / 7);
//   days = days - (weeks * 2);
//
//   // Handle special cases
//   var startDay = startDate.getDay();
//   var endDay = endDate.getDay();
//
//   // Remove weekend not previously removed.
//   if (startDay - endDay > 1)
//   days = days - 2;
//
//   // Remove start day if span starts on Sunday but ends before Saturday
//   if (startDay == 0 && endDay != 6)
//   days = days - 1
//
//   // Remove end day if span ends on Saturday but starts after Sunday
//   if (endDay == 6 && startDay != 0)
//   days = days - 1
//
//   return days;
// }
//
// function reduceTimeIntervals(busyArray){
//     var intervalStack = [];
//     //sort the intervals based on increasing order of starting time
//     var sortedIntervals = _.sortBy(busyArray, 'start');
//     intervalStack.push(sortedIntervals[0]); //push the first interval on stack
//     sortedIntervals.forEach( (interval) => {
//         var stackTop = intervalStack[intervalStack.length - 1];
//         //If the current interval overlaps with stack top and ending
//         //        time of current interval is more than that of stack top,
//         //        update stack top with the ending  time of current interval.
//         if((Date.parse(interval.start) <= Date.parse(stackTop.start)&& Date.parse(interval.end) > Date.parse(stackTop.start)) || (Date.parse(interval.start) >= Date.parse(stackTop.start) && Date.parse(interval.start) <= Date.parse(stackTop.end))){
//             if(Date.parse(interval.end) > Date.parse(stackTop.end)){
//                 var modifiedStackTop = Object.assign({}, intervalStack.pop(), {end: interval.end})
//                 intervalStack.push(modifiedStackTop);
//             }
//         } else {
//             //if for some reason the busy interval has same start and end time, dont add it
//             if(Date.parse(interval.start) !== Date.parse(interval.end)){
//                 intervalStack.push(interval);
//             }
//
//         }
//     })
//     return intervalStack;
// }
//
// function findFreeTimes(busyArray, meetingStartDate, sevenBusinessDays){
//     //meetingStartDate and sevenBusinessDays must be in format '2017-07-22T23:59:59Z'
//     var intervals = reduceTimeIntervals(busyArray);
//     var freeStart = meetingStartDate.slice(0,11)+'00:00:00Z'
//     var freeEnd = sevenBusinessDays.slice(0,11)+'23:59:59Z'
//     var freeStack = []
//     intervals.forEach((interval) => {
//         freeStack.push({start: freeStart, end: interval.start})
//         freeStart = interval.end;
//     })
//     freeStack.push({start: freeStart, end: freeEnd})
//     return freeStack;
// }

function sendInvitations(meeting, user){

    //// old and redundant code
    //// get the invitor's userObj from dataStore
    //// var sender = rtm.dataStore.getUserById(meeting.userID)
    //// find the user by his slackId in the mongodb
    //// User.findOne({slackID: }).exec()
    //// .then((user) => user.pendingInvites = meeting.invitees)

    // 1. add invitees to invitor's pending invites array
    //user that created event and is sending invitations's object gets passed into this function
    user.pendingInvites = meeting.invitees;
    console.log("this is updated pendingInvites", user.pendingInvites);
    user.save()
    .then( () => res.status(200).send("pendingInvites array updated"))
    .catch((err) => {
        console.log('error in saving pendinginvites array to mlabs');
        res.status(400).json({error:err});
    })

    // 2.  get UserId and DM ID from the slack usernames in meeting.invitees =>
    //     check link pam sent in general
    let tempArr = [];
    user.pendingInvites.forEach((invitee) => {
        let xyz = rtm.dataStore.UserByName(invitee)
        console.log("this is UserByName", xyz)
    })



    // var abc = rtm.dataStore.getDMByUserId()
    // tempArr.push(abc);

    // 3. for each invitee send web.chat.postmessage invitation message

    // findAndReturnEmails(meeting.invitees, meeting.date,  meeting.subject, tokens, meeting.time);

}

//4,5,6 for other function...
//when slack user confirms, write new route in /slack/interactive to receive that payload with the information in it
//when they accept, remove their name from the pendingInvites array and check the array's length
//if the array's length is 0, then call create the calendar event

//TODO: how to handle invites who decline. just remove them from pending invites array, and send slack messages
//saying "usernameX declined to attend the meeting", then check array lenght and book calender event with those remaining
