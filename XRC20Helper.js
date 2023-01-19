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
const configuration = require("../models/configuration");
const transactionDetails = require("../models/transactionDetails");
const { getDecryptedData } = require("../helpers/encryption");
const XRC20Transfers = require("./XRC20Transfers");
const addressHelper = require("../helpers/addressHelper");

module.exports = {
  processBlock: async (blockNumber, scanner) => {
    try {
      const currencies = await currencyConnection.find({ type: "XRC20" });
      let i,
        currency,
        internalTransactions,
        j,
        transaction,
        to,
        transactionHash,
        checkTransaction,
        type,
        amount,
        receivingCurrency,
        receivingAddress,
        receivingAmount,
        transferHash,
        fundTransfer,
        addressData,
        addressKey;
      const systemConfig = await configuration.findOne({ id: 1 });
      for (i = 0; i < currencies.length; i++) {
        currency = currencies[i];
        internalTransactions = await module.exports.getInternalTransactions(
          currency.tokenDecimals,
          currency.name,
          currency.contractAddress,
          blockNumber
        );
        if (internalTransactions != null) {
          for (j = 0; j < internalTransactions.length; j++) {
            transaction = internalTransactions[j];
            to = transaction.to;
            transactionHash = transaction.hash;
            amount = transaction.value;
            checkTransaction = await transactionDetails.findOne({
              sendingAddress: to,
              status: "initiated",
              sendingCurrency: currency.name,
            });
            if (checkTransaction) {
              logger.info(`Transaction Found`, transaction, checkTransaction);
              await transactionDetails.updateOne(
                { sessionId: checkTransaction.sessionId },
                {
                  $set: {
                    status: "processing",
                    sendingTxHash: transactionHash,
                  },
                }
              );
              type = checkTransaction.type;
              if (
                (type == "buy" && amount >= checkTransaction.totalWithFees) ||
                (type == "sell" && amount >= checkTransaction.amount)
              ) {
                receivingCurrency = checkTransaction.receivingCurrency;
                receivingAmount =
                  type == "buy"
                    ? checkTransaction.amount
                    : checkTransaction.totalWithFees;
                receivingAddress = checkTransaction.receivingAddress;
                await transactionDetails.updateOne(
                  { sessionId: checkTransaction.sessionId },
                  {
                    $set: {
                      status: "transferred",
                      receivingTxHash: transferHash,
                    },
                  }
                );
              } else {
                //mail
                await transactionDetails.updateOne(
                  { sessionId: checkTransaction.sessionId },
                  { $set: { status: "less amount sent" } }
                );
              }
            }
          }
        }
        if (scanner == "WS") {
          currency.latestBlockWS = blockNumber;
          currency.markModified("latestBlockWS");
          currency.save();
        } else if (scanner == "cron") {
          currency.latestBlock = blockNumber;
          currency.markModified("latestBlock");
          currency.save();
        }
      }
    } catch (error) {
      logger.error(`XRC20Helper_processBlock_error`, error);
    }
  },

  getInternalTransactions: async (
    tokenDecimals,
    tokenName,
    tokenAddress,
    exportStartBlock
  ) => {
    try {
      const contract = await new xdc3.eth.Contract(XRC20Abi, tokenAddress);
      let allEvents = await contract.getPastEvents("Transfer", {
        fromBlock: exportStartBlock - 1,
        toBlock: exportStartBlock,
      });
      // let newEvents = contract.allEvents();
      // console.log("internal tx length", allEvents);

      arrayData = [];

      for (let i = 0; i < allEvents.length; i++) {
        let Event = allEvents[i];

        let txHash = Event.transactionHash.toLowerCase();
        let eventName = Event.event;
        // console.log('txHash', txHash);
        let Result = Event.returnValues;
        // console.log(Result);
        let blockNumber = Event.blockNumber;
        let fromAddress, toAddress;
        if (Result.from != null) {
          fromAddress = Result.from.toLowerCase();
        } else if (Result.sender != null) {
          fromAddress = Result.sender.toLowerCase();
        } else {
          fromAddress = null;
        }
        if (Result.to != null) {
          toAddress = Result.to.toLowerCase();
        } else {
          toAddress = null;
        }

        if (fromAddress.startsWith("0x")) {
          fromAddress = fromAddress.replace("0x", "xdc");
        }
        if (toAddress.startsWith("0x")) {
          toAddress = toAddress.replace("0x", "xdc");
        }

        let amount = Number(Result.value || Result.amount);
        if (allEvents.length == 1) {
          // console.log("getUser", getUser, getTx);
        }

        // if (getUser != null && getTx == null) {
        // console.log("dd", amount, Result);
        let value = amount / 10 ** tokenDecimals;

        arrayData.push({
          from: fromAddress,
          to: toAddress,
          value: value,
          hash: txHash,
          gas: 0,
          blockNumber: blockNumber,
          currency: tokenName,
          contractAddress: tokenAddress,
          decimals: tokenDecimals,
          eventName,
        });

        // }
        if (i === allEvents.length - 1) {
          //   console.log("arrayData", arrayData);
          return arrayData;
        }
      }
    } catch (error) {
      logger.error(`XRC20Helper_getInternalTransactions_error`, error);
      return null;
    }
  },

  adminTransferProcess: async () => {
    try {
      const systemConfig = await configuration.findOne({ id: 1 });
      const currencies = await currencyConnection.find({ type: "XRC20" });
      let i,
        j,
        pendingTransfers,
        currencyName,
        transaction,
        address,
        key,
        feeKey,
        contractAddress,
        decimals,
        feeDetails,
        transferObject,
        sendEther,
        transferAmount,
        transferHash,
        transferReturn;
      const adminAddress = systemConfig.adminAddressXRC20;
      const feeAddress = systemConfig.feesAddressXRC20;
      for (i = 0; i < currencies.length; i++) {
        currencyName = currencies[i].name;
        contractAddress = currencies[i].contractAddress;
        decimals = currencies[i].tokenDecimals;
        pendingTransfers = await transactionDetails
          .find({
            sendingCurrency: currencyName,
            status: "transferred",
            transferStatus: { $nin: ["transferred", "processing"] },
          })
          .sort({ createdAt: 1 });
        for (j = 0; j < pendingTransfers.length; j++) {
          transaction = pendingTransfers[j];
          address = transaction.sendingAddress;
          key = await addressHelper.fetchPrivateKey(address);
          if (key != "") {
            transferObject = {
              decimal: decimals,
              contractAddress: contractAddress,
              toAddress: adminAddress,
              fromAddress: address,
              privateKey: key,
            };
            transferAmount = await module.exports.getTokenBalance(
              transferObject
            );
            if (transferAmount > 0) {
              feeDetails = await module.exports.estimatefeeWithBalance(
                transferObject
              );
              sendEther = "";
              if (feeDetails != "error") {
                if (feeDetails.feetransfer > 0) {
                  feeKey = getDecryptedData(systemConfig.feesKeyXRC20);
                  sendEther = await module.exports.sendFeeXDC(
                    feeAddress,
                    feeKey,
                    address,
                    feeDetails.feetransfer
                  );
                  feeKey = "";
                  sendEther = "success";
                } else {
                  sendEther = "success";
                }
              } else {
                sendEther = "error";
              }
              if (sendEther != "error") {
                await new Promise((resolve) => setTimeout(resolve, 5000));
                transferReturn = await XRC20Transfers.transferXRC20(
                  address,
                  adminAddress,
                  key,
                  transferAmount,
                  currencyName
                );
                key = "";
                if (transferReturn.status == "success") {
                  transferHash = transferReturn.txId;
                  await transactionDetails.updateOne(
                    { sessionId: transaction.sessionId },
                    {
                      $set: {
                        transferStatus: "transferred",
                        transferTxHash: transferHash,
                        transferAddress: adminAddress,
                        feesCurrency: "XDC",
                        feesSent: feeDetails.feetransfer / 10 ** 18,
                      },
                    }
                  );
                }
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error(`XRC20Helper_adminTransferProcess_error`, error);
    }
  },

  getTokenBalance: async function (balanceObject) {
    try {
      let decimal = balanceObject.decimal;
      let contractAddress = balanceObject.contractAddress;
      let fromAddress = balanceObject.fromAddress;

      const coin = new xdc3.eth.Contract(XRC20Abi, contractAddress);

      let tokenBalance = await coin.methods
        .balanceOf(fromAddress)
        .call(function (err, bal) {
          if (err) {
            return "error";
          } else {
            // console.log("balance", bal);
            return bal;
          }
        });
      // console.log("result", tokenBalance, tokenBalance / 10 ** decimal);
      return tokenBalance / 10 ** decimal;
    } catch (exception) {
      console.log("er", exception);
      return "0";
    }
  },

  estimatefeeWithBalance: async function (balanceObject) {
    try {
      let tokenBalance = await module.exports.getTokenBalance(balanceObject);
      // console.log("tokenb", tokenBalance);
      if (tokenBalance > 0 && tokenBalance != "error") {
        var getGasPrice = await xdc3.eth.getGasPrice();
        var getGas = "";
        // if (getGasPrice) {
        //   // console.log("dfff", (getGasPrice * process.env.gasLimit));
        //   if (getGasPrice < 4000000000 || getGasPrice == null) {
        //     // console.log("fdfff", (getGasPrice * process.env.gasLimit));
        //     getGas = 4000000000;
        //   } else {
        //     // console.log("getgasprice", getGasPrice);
        //     getGas = getGasPrice;
        //   }
        // } else {
        //   // console.log("ffff", 4000000000 * process.env.gasLimit);
        //   getGas = 4000000000;
        // }

        getGas = getGasPrice;

        // console.log(getGas, balanceObject.fromAddress);

        var ethBalance = await xdc3.eth.getBalance(balanceObject.fromAddress);
        // console.log("estimate", ethBalance / 10 ** 18, getGas / 10 ** 18);
        let feeAmount = "";
        if (ethBalance > getGas * process.env.gasLimitXRC) {
          feeAmount = {
            fee: getGas,
            feetransfer: 0,
          };
        } else {
          //   let diff = getGas * process.env.gasLimitXRC - ethBalance;
          //   if (diff > 0.0001 * 10 ** 18) {
          //     feeAmount = {
          //       fee: getGas,
          //       feetransfer: diff,
          //     };
          //   } else {
          feeAmount = {
            fee: getGas,
            feetransfer: getGas * process.env.gasLimitXRC,
          };
          // }
        }
        feeAmount.fee = parseInt(feeAmount.fee);
        // console.log("feee", feeAmount);
        return feeAmount;
      }
    } catch (exception) {
      console.log("eeee", exception);
      return "error";
    }
  },

  sendFeeXDC: async function (fromAddress, privateKey, toAddress, sendamount) {
    var send_amount = sendamount.toString();
    var transferamount = xdc3.eth.getBalance(toAddress);
    var est_main_gas = {
      from: fromAddress,
      to: toAddress,
      value: send_amount,
    };

    xdc3.eth.estimateGas(est_main_gas, function (gaslimit_err, gaslimit) {
      xdc3.eth.getGasPrice(function (gas_err, getGasPrice) {
        // if (gas_err) {
        //   console.log(
        //     JSON.stringify({
        //       error1: gas_err,
        //     })
        //   );
        //   getGasPrice = 50000000000;
        // } else {
        //   if (getGasPrice < 50000000000 || getGasPrice == null) {
        //     getGasPrice = 50000000000;
        //   }
        // }

        // transferamount = getGasPrice * process.env.gasLimit;
        // if (transferamount < 4000000000000000) {
        //   transferamount = 4000000000000000;
        // }

        xdc3.eth.getTransactionCount(
          fromAddress,
          "pending",
          function (tx_count_err, transactionCount) {
            if (tx_count_err) {
              console.log(
                JSON.stringify({
                  "transaction count error ": tx_count_err,
                })
              );
            }

            const trans_det = {
              nonce: transactionCount, // Replace by nonce for your account on geth node
              gasPrice: parseInt(getGasPrice),
              gas: "25000",
              to: toAddress, //contract address
              from: fromAddress, //coin base
              value: send_amount,
            };
            // console.log("tx", trans_det, privateKey);
            xdc3.eth.accounts.signTransaction(
              trans_det,
              privateKey,
              function (sign_error, signedTransaction) {
                if (sign_error) {
                  console.log(
                    JSON.stringify({
                      "sign transaction error sendFee ": sign_error,
                    })
                  );
                  return "error";
                }

                const rawTransaction = signedTransaction.rawTransaction;
                // console.log("rawTx", rawTransaction);
                xdc3.eth.sendSignedTransaction(
                  rawTransaction.toString("hex"),
                  function (trans_err, txid) {
                    if (trans_err) {
                      console.log(
                        JSON.stringify({
                          "transaction error": trans_err,
                        })
                      );
                      return "error";
                    }
                    if (txid && txid != "") {
                      console.log(
                        JSON.stringify({
                          tx: txid,
                          hash: txid,
                        })
                      );
                      return txid;
                    } else {
                      return "error";
                    }
                  }
                );
              }
            );
          }
        );
      });
    });
  },
};
