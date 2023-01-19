const { removeExpo, convertToChecksum } = require("../helpers/common");
const currencyConnection = require("../models/currencyConnection");
const XRC20Abi = require("../abis/XRC20.json");
const Xdc3 = require("xdc3");
const xdc3 = new Xdc3(new Xdc3.providers.HttpProvider(process.env.XDCRPC));
xdc3.eth.net
  .isListening()
  .then(() => console.log("XDC Connected to : ", xdc3.currentProvider.host))
  .catch(() => {
    "XDC Connection Failed";
  });

module.exports = {
  transferXRC20: async (
    fromAddress,
    toAddress,
    privateKey,
    amount,
    currencyName
  ) => {
    try {
      fromAddress = convertToChecksum(fromAddress);
      toAddress = convertToChecksum(toAddress);
      const transferObject = await currencyConnection.findOne({
        name: currencyName,
      });
      // console.log("** GOT request for sendERC: ", apiData, transferObject, from)
      let decimal = transferObject.tokenDecimals;
      let contractAddress = transferObject.contractAddress;
      // let privateKey = await dotNetHelper.getPrivKey(apiData.email);
      let withdrawalAmt;
      if (decimal === 18 || decimal === null) {
        withdrawalAmt = xdc3.utils.toWei(amount + "", "ether");
        // console.log("withdrawal Amount", withdrawalAmt);
      } else {
        withdrawalAmt = parseFloat(amount * 10 ** decimal);
        withdrawalAmt = parseFloat(withdrawalAmt).toFixed(0);
        withdrawalAmt = removeExpo(withdrawalAmt);
      }
      // withdrawalAmt = parseFloat(withdrawalAmt).toFixed(0)+"";
      var getGasPrice = await xdc3.eth.getGasPrice();
      var getGas = "";
      if (getGasPrice) {
        // console.log("dfff", (getGasPrice * process.env.gasLimit));
        // if (getGasPrice < 4000000000 || getGasPrice == null) {
        //     // console.log("fdfff", (getGasPrice * process.env.gasLimit));
        //     getGas = 4000000000;
        // } else {
        //     console.log("getgasprice", getGasPrice);
        //     getGas = getGasPrice;
        // }
        getGas = getGasPrice;
      } else {
        // console.log("ffff", 4000000000 * process.env.gasLimit);
        getGas = 4000000000;
      }
      //check available balance in acc first
      const coin = new xdc3.eth.Contract(XRC20Abi, contractAddress);
      let txdata = "";
      let getBalance = await xdc3.eth.getBalance(fromAddress);
      //   console.log("b", getBalance);
      let returnData = {};
      if (Number(getBalance) >= getGas) {
        var data = await coin.methods
          .balanceOf(fromAddress)
          .call(async function (err, bal) {
            if (err) {
              console.log(err);
              return 0;
            } else {
              //retrieving txcount which will be used as nonce
              return bal;
            }
          });
        // console.log("bd", data, withdrawalAmt);
        if (data >= parseFloat(withdrawalAmt)) {
          amountToString = withdrawalAmt.toString();
          // console.log("dddq", toAddress, withdrawalAmt)
          txdata = coin.methods.transfer(toAddress, amountToString).encodeABI();
          // console.log("txData", txdata);
          var txCount = await xdc3.eth.getTransactionCount(
            fromAddress,
            async function (tx_count_err, transactionCount) {
              if (tx_count_err) {
                returnData = {
                  status: 500,
                  message: "Error in retrieving transaction count",
                };
                return "error";
              } else {
                return transactionCount;
              }
            }
          );
          // console.log("txCount", txCount);
          if (txCount != "error") {
            // const gasLimit = await xdc3.eth.estimateGas({to:contractAddress, data: txdata });
            // console.log("[*] estimate gas in XRC20WithdrawalHelper: ",gasLimit );
            let trans_det = {
              nonce: txCount, // Replace by nonce for your account on geth node
              gasPrice: getGas,
              gas: process.env.gasLimitXRC,
              to: contractAddress, //contract address
              from: fromAddress, //coin base
              data: txdata,
            };
            //   console.log("trans_det", trans_det);
            //creating raw transaction from above details
            var signedTx = await xdc3.eth.accounts.signTransaction(
              trans_det,
              privateKey,
              async function (sign_error, signedTransaction) {
                if (sign_error) {
                  return "error";
                } else {
                  return signedTransaction;
                }
              }
            );
            // console.log("rawTx", signedTx);
            //end of raw transaction method
            if (signedTx != "error") {
              const rawTransaction = signedTx.rawTransaction;
              //send signed transaction
              var sendData = await xdc3.eth.sendSignedTransaction(
                rawTransaction.toString("hex"),
                async function (trans_err, txid) {
                  if (trans_err) {
                    console.log(
                      JSON.stringify({
                        "transaction error": trans_err,
                        trans_det,
                      })
                    );

                    return "error";
                  } else {
                    return txid;
                  }
                }
              ); //send signed transaction ends here

              if (sendData != "error") {
                if (sendData && sendData != "") {
                  console.log(
                    JSON.stringify({
                      tx: sendData.transactionHash,
                      hash: sendData.transactionHash,
                    })
                  );
                  returnData = {
                    status: "success",
                    txId: sendData.transactionHash,
                  };
                  return returnData;
                } else {
                  returnData = {
                    status: "error",
                    message: "Error in sending signed transaction",
                  };
                  return returnData;
                }
              } else {
                return {
                  status: "error",
                  message: "Error in sending transaction",
                };
              }
            } else {
              return {
                status: "error",
                message: "Error in signing the transaction",
              };
            }
          } else {
            returnData = {
              status: "error",
              message: "Error in nonce",
            };
            // console.log("its working not according to flow", returnData);
            return returnData;
          }
        } else {
          returnData = {
            status: "error",
            message: "Insufficient balance",
          };
          return returnData;
        }
      }
    } catch (error) {
      logger.error(`XRC20Transfers_transferXRC20_error`, error);
      return {
        status: "error",
        message: `Server error : ${JSON.stringify(error)}`,
      };
    }
  },
};
