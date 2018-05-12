var mongoose = require('mongoose');
var {Meeting, User} = require('./models');
mongoose.connect(process.env.MONGODB_URI);
var _ = require('underscore')

// var {RtmClient, CLIENT_EVENTS, RTM_EVENTS} = require('@slack/client');
// same as var RtmClient = require('@slack/client').RtmClient

var token = process.env.SLACK_API_TOKEN || '';
//
// var rtm = new RtmClient(token);
// var web = new WebClient(token);
// rtm.start();


var meetingSchema = new Schema({
  userID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
  },
  subject: String,
  channelID: String,
  date: String,
  invitees: Array,
  time: String,
})

// getUserByName
//U6ANS0NNS
var pamtofrankie = {
    userID: '596f927c2945b10011ad86b0',
    invitees: ['fflores'],
    subject: 'get some dinna',
    channelID: 'D6ATM9WMU',
    date: '2017-07-20',
    time: '17:00:00'

}

checkConflicts(meeting){
    // var meetingStart = meeting.date+'T'+meeting.time+'-00:00';
    var dateSplit = meeting.split('-');
    var timeSplit = meeting.time.split(':');
    var meetingStart = new Date(dateSplit[0], dateSplit[1], dateSplit[2], timeSplit[0], timeSplit[1], timeSplit[2]).toISOString();
    var meetingEnd = new Date(dateSplit[0], dateSplit[1], dateSplit[2], timeSplit[0] + 1, timeSplit[1], timeSplit[2]).toISOString();

    meeting.invitees.forEach( function(invitee) {
        var inviteeuser = rtm.dataStore.getUserByName(invitee);
        var inviteeSlackID = inviteeuser.id;
        User.findOne({slackID: inviteeSlackID}, function(err, user) {
            if(user) {
                var tokens = user.token;
                oauth2Client = new OAuth2(
                  process.env.GOOGLE_CLIENT_ID,
                  process.env.GOOGLE_CLIENT_SECRET,
                  process.env.DOMAIN + '/connect/callback'
                )
                oauth2Client.setCredentials(tokens);
                var calendar = google.calendar('v3');
                calendar.freebusy.query({
                    auth: oauth2Client,
                    items: [{id: 'primary', busy: 'Active'}]
                    timeMax: (new Date(2017, 7, 21)).toISOString(),
                    timeMin: (new Date(2017, 7, 20)).toISOString()
                }, function(err, schedule) {
                  if(err){
                    console.log("There was an error adding the calendar", err);
                    return
                  }else {
                    var busyList = schedule.calendars.busy;
                    busyList.forEach((time) => {
                        console.log('busy at time: ', time.start, time.end);
                    })
                  }
                })

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
        })
    })
}


findReminders(rtm);
