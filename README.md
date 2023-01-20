# XRC20Deposit-Example

Example for detecting XRC20 Deposits and transferring them to admin wallet.

You can tweek the code as per your requirements.

1. Call the **XRC20Listener.js** file in your app.js so it will start listening for new blocks on the XDC Network.
2. On every new block **processBlock** function will be called in the **XRC20Helper.js** file.
3. It will process the block :
   1. Fetch the transactions for the block for the provided contract address of the XRC20 token .
   2. Check whether the toAddress of any of the transactions is related to the one that we need.
   3. Update the details in the DB to indicate pending transfer to the required address.
4. Call the **adminTransferProcess** function in the **XRC20Helper.js** file as per your required interval.
   1. Fetch the pending transfers to the required address from the DB.
   2. Check the XDC balance of the from address, if not sufficient balance, transfer the amount of XDC needed for the XRC20 to be transferred.
   3. Wait for the XDC to be credited, then transfer the complete XRC20 balance to the required address.
