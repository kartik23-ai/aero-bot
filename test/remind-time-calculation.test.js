"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ai, handleRemindCommand } = require("../src/server");

test("handleRemindCommand parses relative time offset correctly", async () => {
  const originalRunChatCompletion = ai.runChatCompletion;
  
  // Mock AI response for relative 15 mins reminder
  ai.runChatCompletion = async () => {
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({
              target: "me",
              task: "drink water",
              timeSpecification: {
                type: "relative",
                daysOffset: 0,
                hoursOffset: 0,
                minutesOffset: 15
              }
            })
          }
        }
      ]
    };
  };

  try {
    const res = await handleRemindCommand("group-1", "user-1", "yamdut", "in 15 minutes to drink water", "remind");
    assert.match(res, /Reminder set successfully/);
    assert.match(res, /drink water/);
    assert.match(res, /in ~15 minutes/);
  } finally {
    ai.runChatCompletion = originalRunChatCompletion;
  }
});

test("handleRemindCommand parses absolute time correctly", async () => {
  const originalRunChatCompletion = ai.runChatCompletion;
  
  // Mock AI response for absolute 10:00 PM reminder (tomorrow)
  ai.runChatCompletion = async () => {
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({
              target: "group",
              task: "daily standup",
              timeSpecification: {
                type: "absolute",
                daysOffset: 1,
                absoluteTime: "10:00 AM"
              }
            })
          }
        }
      ]
    };
  };

  try {
    const res = await handleRemindCommand("group-1", "user-1", "yamdut", "tomorrow at 10 AM about daily standup", "remind");
    assert.match(res, /Reminder set successfully/);
    assert.match(res, /Target: Group/);
    assert.match(res, /daily standup/);
  } finally {
    ai.runChatCompletion = originalRunChatCompletion;
  }
});
