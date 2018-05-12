var mongoose = require('mongoose');
var {Reminder} = require('./models');
mongoose.connect(process.env.MONGODB_URI);
var _ = require('underscore');
var bluebird = require('bluebird')

var {RtmClient, CLIENT_EVENTS, RTM_EVENTS} = require('@slack/client');
// same as var RtmClient = require('@slack/client').RtmClient

var token = process.env.SLACK_API_TOKEN || '';

var rtm = new RtmClient(token);
// var web = new WebClient(token);
rtm.start();

findReminders(rtm);


function postMessage( msg, channelId) {
    return new Promise(function(resolve, reject){
        rtm.sendMessage('message body',channelId, function(err) {
            if(err) {
                reject(err);
            } else {
                resolve();
            }
        })
    })
}

var promisifiedPostMessage = bluebird.promisify(rtm.sendMessage.bind(rtm)) //USE EITHER THIS OR MY DEFINITION OF POSTMESSAGE

function findReminders(rtm){
  var now = Date.now();
  var tomorrow = new Date(new Date().getTime() + 24 * 60 * 60 * 1000).getTime();
  Reminder.find({}).where('date').gt(now).lt(tomorrow)
  .populate('userID')
  .then(function(reminders) {
      var groupedReminders = _.groupBy(reminders, function(reminder) {
          // console.log('REMINDER IN GROUPEDREMINDER IS', reminder);
          return reminder.userID._id
      });
      var promises = Object.keys(groupedReminders).map(function(reminder) {
          var userReminders = groupedReminders[user];
          var reminderString = "";
          var channel;
          userReminders.forEach(function(reminder) {
              channel = reminder.channelID;
              // var dmChannel = rtm.dataStore.getDMByUserId(reminder.userID.slackID);
              var date = new Date(reminder.date);
              var str = `Reminder: ${date} for ${reminder.subject} \n`;
              reminderString+= str;
          })
          // console.log('sending remidner string to user ', reminderString);
          // console.log('rtm issss', rtm);
          return promisifiedPostMessage(reminderString, channel); //ORRR JUST CALL MY POSTMESSAGES
      })
      return Promise.all(promises);
  })
  .then((promises) => {

      console.log('successs SENDING REMIDNERS');
      process.exit(0)
  })
  .catch((err) => {
      console.log('ERROR SENDING REMINDERS');
      process.exit(0);
  })


  // .exec(function(err,reminders){
  //   if (err){
  //     // res.status(400).json({error:err});
  //     console.log('error', err);
  //   }else {
  //       if(reminders){
  //           //group the reminders by user id
  //           var groupedReminders = _.groupBy(reminders, function(reminder) {
  //               // console.log('REMINDER IN GROUPEDREMINDER IS', reminder);
  //               return reminder.userID._id
  //           });
  //
  //           Object.keys(groupedReminders).forEach(function(user) {
  //               var userReminders = groupedReminders[user];
  //               var reminderString = "";
  //               var channel;
  //               // console.log('user reminders for ', user, 'are ', userReminders);
  //               userReminders.forEach(function(reminder) {
  //                   channel = reminder.channelID;
  //                   // var dmChannel = rtm.dataStore.getDMByUserId(reminder.userID.slackID);
  //                   var date = new Date(reminder.date);
  //                   var str = `Reminder: ${date} for ${reminder.subject} \n`;
  //                   reminderString+= str;
  //               })
  //               // console.log('sending remidner string to user ', reminderString);
  //               // console.log('rtm issss', rtm);
  //               postMessage(channel, reminderString);
  //               rtm.sendMessage(reminderString, channel);
  //
  //           })
  //
  //       }
  //   }
  // })
}


// var date = new Date();
// var threedaysago = date.setDate(date.getDate() - 3);
// var tomorrow = new Date(new Date().getTime() + 24 * 60 * 60 * 1000).getTime();
// var today = new Date(new Date().getTime() + 2 * 60 * 60 * 1000).getTime();
// var threedaysfromnow = date.setDate(date.getDate() + 3);

// var oldreminder = new Reminder({
//     userID: 'U6ANS0NNS',
//     subject: 'This is a reminder from 3 days ago',
//     access_token: process.env.API_ACCESS_TOKEN,
//     date: threedaysago
// })
//
// var tomorrowreminder = new Reminder({
//     userID: 'U6ANS0NNS',
//     subject: 'This is a reminder from tomorrow',
//     access_token: process.env.API_ACCESS_TOKEN,
//     date: tomorrow
// })
//
// var todayreminder = new Reminder({
//     userID: 'U6ANS0NNS',
//     subject: 'This is a reminder from today',
//     access_token: process.env.API_ACCESS_TOKEN,
//     date: today
// })
//
// var futurereminder = new Reminder({
//     userID: 'U6ANS0NNS',
//     subject: 'This is a reminder for 3 days FROM NOW',
//     access_token: process.env.API_ACCESS_TOKEN,
//     date: threedaysfromnow
// })

// mongoose.Promise = global.Promise;
// oldreminder.save()
// .then(()=>todayreminder.save())
// .then(()=>tomorrowreminder.save())
// .then(()=>futurereminder.save())
// .then(()=>reminderTest())
