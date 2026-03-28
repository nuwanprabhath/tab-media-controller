const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  runScripts: "dangerously",
});
const { window } = dom;

global.window = window;
global.document = window.document;
global.navigator = window.navigator;
