const Xdc3 = require("xdc3");
const { processBlock } = require("./XRC20Helper");
const xdc3 = new Xdc3(new Xdc3.providers.WebsocketProvider(process.env.XDCWS));
xdc3.eth.net
  .isListening()
  .then(() => console.log("XRC20 is connected"))
  .catch((e) => console.log("Wow. Something Went Wrong in XRC20"));

/* This creates and event emitter linked to eth_subscribe */
const subscription = xdc3.eth.subscribe("newBlockHeaders");

/* This exposes the events from the subscription, synchronously */
subscription.on("data", async (block, error) => {
  const blockNumber = block.number;
  processBlock(blockNumber, "WS");
});
