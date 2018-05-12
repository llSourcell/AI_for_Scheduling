var mongoose = require('mongoose');
var {Reminder} = require('./models');
mongoose.connect(process.env.MONGODB_URI);
var _ = require('underscore')
var {RtmClient, CLIENT_EVENTS, RTM_EVENTS} = require('@slack/client');
// same as var RtmClient = require('@slack/client').RtmClient
var token = process.env.SLACK_API_TOKEN || '';
var rtm = new RtmClient(token);
// var web = new WebClient(token);
rtm.start();
findReminders(rtm);
function findReminders(rtm){
  var now = Date.now();
  var tomorrow = new Date(new Date().getTime() + 24 * 60 * 60 * 1000).getTime();
  Reminder.find({}).where('date').gt(now).lt(tomorrow).populate('userID').exec(function(err,reminders){
    if (err){
      // res.status(400).json({error:err});
      console.log('error', err);
    }else {
        if(reminders){
            //group the reminders by user id
            var groupedReminders = _.groupBy(reminders, function(reminder) {
                // console.log('REMINDER IN GROUPEDREMINDER IS', reminder);
                return reminder.userID._id
            });
            Object.keys(groupedReminders).forEach(function(user) {
                var userReminders = groupedReminders[user];
                var reminderString = "";
                var channel;
                // console.log('user reminders for ', user, 'are ', userReminders);
                userReminders.forEach(function(reminder) {
                    channel = reminder.channelID;
                    // var dmChannel = rtm.dataStore.getDMByUserId(reminder.userID.slackID);
                    var date = new Date(reminder.date);
                    var str = `Reminder: ${date} for ${reminder.subject} \n`;
                    reminderString+= str;
                })
                // console.log('sending remidner string to user ', reminderString);
                // console.log('rtm issss', rtm);
                rtm.sendMessage(reminderString, channel);
            })
        }
    }
  })
}
