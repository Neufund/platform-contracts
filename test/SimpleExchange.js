import { expect } from "chai";
import { prettyPrintGasCost, gasCost } from "./helpers/gasUtils";
import { eventValue } from "./helpers/events";
import { promisify } from "./helpers/evmCommands";
import { latestTimestamp } from "./helpers/latestTime";
import {
  deployUniverse,
  deployEtherTokenUniverse,
  deployEuroTokenUniverse,
  deploySimpleExchangeUniverse,
  deployNeumarkUniverse,
  deployIdentityRegistry,
} from "./helpers/deployContracts";
import { expectTransferEvent } from "./helpers/tokenTestCases";
import roles from "./helpers/roles";
import createAccessPolicy from "./helpers/createAccessPolicy";
import { divRound, etherToWei } from "./helpers/unitConverter";
import increaseTime from "./helpers/increaseTime";
import { toBytes32, Q18, contractId, ZERO_ADDRESS } from "./helpers/constants";

const gasExchangeMaxAllowanceEurUlps = Q18.mul(50);
const gasExchangeFee = Q18.mul(0.07);
const hasKYCandHasAccount = toBytes32("0x5");

contract(
  "SimpleExchange",
  ([
    _,
    admin,
    gasExchangeManager,
    tokenOracleManager,
    gasRecipient,
    anotherGasRecipient,
    platformWallet,
    randomAddress,
  ]) => {
    let universe;
    let accessPolicy;
    let rateOracle;
    let gasExchange;
    let simpleExchange;
    let etherToken;
    let euroToken;
    let euroTokenController;
    let identityRegistry;

    beforeEach(async () => {
      [universe, accessPolicy] = await deployUniverse(admin, admin);
      identityRegistry = await deployIdentityRegistry(universe, admin, admin);
      etherToken = await deployEtherTokenUniverse(universe, admin);
      [euroToken, euroTokenController] = await deployEuroTokenUniverse(
        universe,
        admin,
        admin,
        admin,
        0,
        0,
        gasExchangeMaxAllowanceEurUlps,
      );
      [gasExchange, rateOracle, simpleExchange] = await deploySimpleExchangeUniverse(
        universe,
        admin,
        etherToken,
        euroToken,
        gasExchangeManager,
        tokenOracleManager,
      );
    });

    it("should deploy", async () => {
      await prettyPrintGasCost("SimpleExchange deploy", simpleExchange);
      expect((await simpleExchange.contractId())[0]).to.eq(contractId("SimpleExchange"));
    });

    it("should set exchange rate", async () => {
      const tx = await gasExchange.setExchangeRate(
        etherToken.address,
        euroToken.address,
        Q18.mul(100),
        { from: tokenOracleManager },
      );
      expect(tx.logs.length).to.eq(2);
      expectLogSetExchangeRate(tx.logs[0], etherToken.address, euroToken.address, Q18.mul(100));
      expectLogSetExchangeRate(tx.logs[1], euroToken.address, etherToken.address, Q18.mul(0.01));
      const rate = await rateOracle.getExchangeRate(etherToken.address, euroToken.address);
      let timestamp = await latestTimestamp();
      expect(rate[0]).to.be.bignumber.eq(Q18.mul(100));
      expect(rate[1].sub(timestamp).abs()).to.be.bignumber.lt(2);
      const invRate = await rateOracle.getExchangeRate(euroToken.address, etherToken.address);
      timestamp = await latestTimestamp();
      expect(invRate[0]).to.be.bignumber.eq(Q18.mul(0.01));
      expect(invRate[1].sub(timestamp).abs()).to.be.bignumber.lt(2);
    });

    it("should set exchange rate after day", async () => {
      const tx = await gasExchange.setExchangeRate(
        etherToken.address,
        euroToken.address,
        Q18.mul(100),
        { from: tokenOracleManager },
      );

      expect(tx.logs.length).to.eq(2);
      expectLogSetExchangeRate(tx.logs[0], etherToken.address, euroToken.address, Q18.mul(100));
      expectLogSetExchangeRate(tx.logs[1], euroToken.address, etherToken.address, Q18.mul(0.01));

      const dayDuration = 1 * 60 * 24;
      await increaseTime(dayDuration);

      const rate = await rateOracle.getExchangeRate(etherToken.address, euroToken.address);
      let timestamp = await latestTimestamp();
      expect(rate[0]).to.be.bignumber.eq(Q18.mul(100));
      expect(rate[1].sub(timestamp - dayDuration).abs()).to.be.bignumber.lt(2);
      const invRate = await rateOracle.getExchangeRate(euroToken.address, etherToken.address);
      timestamp = await latestTimestamp();
      expect(invRate[0]).to.be.bignumber.eq(Q18.mul(0.01));
      expect(invRate[1].sub(timestamp - dayDuration).abs()).to.be.bignumber.lt(2);

      const txAfterDay = await gasExchange.setExchangeRate(
        euroToken.address,
        etherToken.address,
        Q18.mul(0.001),
        { from: tokenOracleManager },
      );

      expect(txAfterDay.logs.length).to.eq(2);
      expectLogSetExchangeRate(
        txAfterDay.logs[0],
        euroToken.address,
        etherToken.address,
        Q18.mul(0.001),
      );
      expectLogSetExchangeRate(
        txAfterDay.logs[1],
        etherToken.address,
        euroToken.address,
        Q18.mul(1000),
      );

      const rateAfterDay = await rateOracle.getExchangeRate(etherToken.address, euroToken.address);
      timestamp = await latestTimestamp();

      expect(rateAfterDay[0]).to.be.bignumber.eq(Q18.mul(1000));
      expect(rateAfterDay[1].sub(timestamp).abs()).to.be.bignumber.lt(2);

      const inversedRateAfterDay = await rateOracle.getExchangeRate(
        euroToken.address,
        etherToken.address,
      );
      timestamp = await latestTimestamp();
      expect(inversedRateAfterDay[0]).to.be.bignumber.eq(Q18.mul(0.001));
      expect(inversedRateAfterDay[1].sub(timestamp).abs()).to.be.bignumber.lt(2);
    });

    it("should set many exchange rates", async () => {
      const neuToken = await deployNeumarkUniverse(universe, admin);
      const tx = await gasExchange.setExchangeRates(
        [etherToken.address, neuToken.address],
        [euroToken.address, euroToken.address],
        [Q18.mul(100), Q18.mul(0.4)],
        { from: tokenOracleManager },
      );
      expect(tx.logs.length).to.eq(4);
      expectLogSetExchangeRate(tx.logs[0], etherToken.address, euroToken.address, Q18.mul(100));
      expectLogSetExchangeRate(tx.logs[1], euroToken.address, etherToken.address, Q18.mul(0.01));
      expectLogSetExchangeRate(tx.logs[2], neuToken.address, euroToken.address, Q18.mul(0.4));
      expectLogSetExchangeRate(tx.logs[3], euroToken.address, neuToken.address, Q18.mul(2.5));
      const rates = await rateOracle.getExchangeRates(
        [etherToken.address, neuToken.address],
        [euroToken.address, euroToken.address],
      );
      let timestamp = await latestTimestamp();
      expect(rates[0][0]).to.be.bignumber.eq(Q18.mul(100));
      expect(rates[1][0].sub(timestamp).abs()).to.be.bignumber.lt(2);
      expect(rates[0][1]).to.be.bignumber.eq(Q18.mul(0.4));
      expect(rates[1][1].sub(timestamp).abs()).to.be.bignumber.lt(2);
      const invRates = await rateOracle.getExchangeRates(
        [euroToken.address, euroToken.address],
        [etherToken.address, neuToken.address],
      );
      timestamp = await latestTimestamp();
      expect(invRates[0][0]).to.be.bignumber.eq(Q18.mul(0.01));
      expect(invRates[1][0].sub(timestamp).abs()).to.be.bignumber.lt(2);
      expect(invRates[0][1]).to.be.bignumber.eq(Q18.mul(2.5));
      expect(invRates[1][1].sub(timestamp).abs()).to.be.bignumber.lt(2);
    });

    it("should set same echanage rates multiple times", async () => {
      const tx = await gasExchange.setExchangeRates(
        [etherToken.address, euroToken.address],
        [euroToken.address, etherToken.address],
        [Q18.mul(100), Q18.mul(0.01)],
        { from: tokenOracleManager },
      );
      expect(tx.logs.length).to.eq(4);

      expectLogSetExchangeRate(tx.logs[0], etherToken.address, euroToken.address, Q18.mul(100));
      expectLogSetExchangeRate(tx.logs[1], euroToken.address, etherToken.address, Q18.mul(0.01));
      expectLogSetExchangeRate(tx.logs[3], etherToken.address, euroToken.address, Q18.mul(100));
      expectLogSetExchangeRate(tx.logs[2], euroToken.address, etherToken.address, Q18.mul(0.01));

      const rates = await rateOracle.getExchangeRates(
        [etherToken.address, euroToken.address],
        [euroToken.address, etherToken.address],
      );

      expect(rates[0][0]).to.be.bignumber.eq(Q18.mul(100));
      expect(rates[0][1]).to.be.bignumber.eq(Q18.mul(0.01));
      expect(rates[1][0]).to.be.bignumber.eq(rates[1][1]);
    });

    it("should revert on set exchange rate not from tokenOracleManager", async () => {
      // this should work
      gasExchange.setExchangeRate(etherToken.address, euroToken.address, Q18.mul(100), {
        from: tokenOracleManager,
      });
      const rate = await rateOracle.getExchangeRate(etherToken.address, euroToken.address);
      expect(rate[0]).to.be.bignumber.eq(Q18.mul(100));

      // this should fail for authentication reasons
      await expect(
        gasExchange.setExchangeRate(etherToken.address, euroToken.address, Q18.mul(90), {
          from: randomAddress,
        }),
      ).to.revert;
      const rateAfterFailedTx = await rateOracle.getExchangeRate(
        etherToken.address,
        euroToken.address,
      );
      expect(rateAfterFailedTx[0]).to.be.bignumber.eq(Q18.mul(100));
    });

    it("should revert on set exchange rate when setting", async () => {
      await expect(
        gasExchange.setExchangeRate(etherToken.address, etherToken.address, Q18.mul(0.1), {
          from: tokenOracleManager,
        }),
      ).to.be.rejectedWith("SEX_SAME_N_D");
    });

    it("should return 0 timestamp on unknown rate", async () => {
      const rate = await rateOracle.getExchangeRate(ZERO_ADDRESS, ZERO_ADDRESS);
      expect(rate[1]).to.be.bignumber.eq(0);
    });

    it("should exchange EuroToken to gas", async () => {
      const decimalExchangeAmount = 20;
      const exchangedAmount = Q18.mul(decimalExchangeAmount);
      const rate = Q18.mul(601.65123);
      const initalBalance = await promisify(web3.eth.getBalance)(gasRecipient);

      await setGasExchangeRateAndAllowance(rate, gasExchangeMaxAllowanceEurUlps);
      await depositEuroToken(gasRecipient, Q18.mul(40));
      await sendEtherToExchange(_, Q18);

      const tx = await gasExchange.gasExchange(gasRecipient, exchangedAmount, gasExchangeFee, {
        from: gasExchangeManager,
      });
      const expectedWei = divRound(
        exchangedAmount.sub(gasExchangeFee.mul(decimalExchangeAmount)),
        new web3.BigNumber(601.65123),
      );
      const invRate = divRound(Q18.mul(Q18), rate);
      expectLogGasExchange(
        tx.logs[0],
        gasRecipient,
        exchangedAmount,
        gasExchangeFee,
        expectedWei,
        invRate,
      );
      // check balances
      expect(await euroToken.balanceOf(gasExchange.address)).to.be.bignumber.eq(exchangedAmount);
      const afterBalance = await promisify(web3.eth.getBalance)(gasRecipient);
      expect(
        afterBalance
          .sub(initalBalance)
          .sub(expectedWei)
          .abs(),
      ).to.be.bignumber.lt(10);
      // simple check if we are not doing stupid error of using invesrse rate and selling wei for cheap
      expect(exchangedAmount).to.be.bignumber.gt(afterBalance.sub(initalBalance));
      // set platform_wallet as reclaimer for gasExchange and extract euro
      await reclaimEuroFromExchange(platformWallet);
      expect(await euroToken.balanceOf(gasExchange.address)).to.be.bignumber.eq(0);
      expect(await euroToken.balanceOf(platformWallet)).to.be.bignumber.eq(exchangedAmount);
    });

    it("should exchange EuroToken to gas for multiple accounts", async () => {
      const decimalExchangeAmount1 = 20;
      const exchangedAmount1 = Q18.mul(decimalExchangeAmount1);
      const decimalExchangeAmount2 = 17.90128;
      const exchangedAmount2 = Q18.mul(decimalExchangeAmount2);
      const rate = Q18.mul(601.65123);
      const initalBalance1 = await promisify(web3.eth.getBalance)(gasRecipient);
      const initalBalance2 = await promisify(web3.eth.getBalance)(anotherGasRecipient);

      await setGasExchangeRateAndAllowance(rate, gasExchangeMaxAllowanceEurUlps);
      await depositEuroToken(gasRecipient, Q18.mul(40));
      await depositEuroToken(anotherGasRecipient, Q18.mul(40));
      await sendEtherToExchange(_, Q18);

      const tx = await gasExchange.gasExchangeMultiple(
        [gasRecipient, anotherGasRecipient],
        [exchangedAmount1, exchangedAmount2],
        gasExchangeFee,
        {
          from: gasExchangeManager,
        },
      );
      expect(tx.logs.length).to.eq(2);
      const expectedWei1 = divRound(
        exchangedAmount1.sub(gasExchangeFee.mul(decimalExchangeAmount1)),
        new web3.BigNumber(601.65123),
      );
      const expectedWei2 = divRound(
        exchangedAmount2.sub(gasExchangeFee.mul(decimalExchangeAmount2)),
        new web3.BigNumber(601.65123),
      );
      const invRate = divRound(Q18.mul(Q18), rate);
      expectLogGasExchange(
        tx.logs[0],
        gasRecipient,
        exchangedAmount1,
        gasExchangeFee,
        expectedWei1,
        invRate,
      );
      expectLogGasExchange(
        tx.logs[1],
        anotherGasRecipient,
        exchangedAmount2,
        gasExchangeFee,
        expectedWei2,
        invRate,
      );
      // check balances
      expect(await euroToken.balanceOf(gasExchange.address)).to.be.bignumber.eq(
        exchangedAmount1.add(exchangedAmount2),
      );
      const afterBalance1 = await promisify(web3.eth.getBalance)(gasRecipient);
      const afterBalance2 = await promisify(web3.eth.getBalance)(anotherGasRecipient);
      expect(
        afterBalance1
          .sub(initalBalance1)
          .sub(expectedWei1)
          .abs(),
      ).to.be.bignumber.lt(10);
      expect(
        afterBalance2
          .sub(initalBalance2)
          .sub(expectedWei2)
          .abs(),
      ).to.be.bignumber.lt(10);
      // set platform_wallet as reclaimer for gasExchange and extract euro
      await reclaimEuroFromExchange(platformWallet);
      expect(await euroToken.balanceOf(gasExchange.address)).to.be.bignumber.eq(0);
      expect(await euroToken.balanceOf(platformWallet)).to.be.bignumber.eq(
        exchangedAmount1.add(exchangedAmount2),
      );
    });

    it("should revert on not set exchange rate", async () => {
      const decimalExchangeAmount = 20;
      const exchangedAmount = Q18.mul(decimalExchangeAmount);

      await depositEuroToken(gasRecipient, Q18.mul(40));
      await sendEtherToExchange(_, Q18);

      await expect(
        gasExchange.gasExchange(gasRecipient, exchangedAmount, gasExchangeFee, {
          from: gasExchangeManager,
        }),
      ).to.revert;
    });

    it("should revert on exchange bigger than permanent allowance", async () => {
      const exchangedAmount = gasExchangeMaxAllowanceEurUlps.add(1); // larger than gasExchangeMaxAllowanceEurUlps
      const rate = Q18.mul(601.65123);

      await setGasExchangeRateAndAllowance(rate, gasExchangeMaxAllowanceEurUlps);
      await depositEuroToken(gasRecipient, Q18.mul(40));
      await sendEtherToExchange(_, Q18);

      await expect(
        gasExchange.gasExchange(gasRecipient, exchangedAmount, gasExchangeFee, {
          from: gasExchangeManager,
        }),
      ).to.revert;
    });

    it("should revert on exchange if rate older than 1 hour", async () => {
      const decimalExchangeAmount = 20;
      const exchangedAmount = Q18.mul(decimalExchangeAmount);
      const rate = Q18.mul(601.65123);

      await setGasExchangeRateAndAllowance(rate, gasExchangeMaxAllowanceEurUlps);
      await depositEuroToken(gasRecipient, Q18.mul(40));
      await sendEtherToExchange(_, Q18);

      const hour = 60 * 60;
      increaseTime(hour);

      await expect(
        gasExchange.gasExchange(gasRecipient, exchangedAmount, gasExchangeFee, {
          from: gasExchangeManager,
        }),
      ).to.rejectedWith("SEX_OLD_RATE");
    });

    it("should revert on multi exchange if rate older than 1 hour", async () => {
      const decimalExchangeAmount = 20;
      const exchangedAmount = Q18.mul(decimalExchangeAmount);
      const rate = Q18.mul(601.65123);

      await setGasExchangeRateAndAllowance(rate, gasExchangeMaxAllowanceEurUlps);
      await depositEuroToken(gasRecipient, Q18.mul(40));
      await sendEtherToExchange(_, Q18);

      const hour = 60 * 60;
      increaseTime(hour);

      await expect(
        gasExchange.gasExchangeMultiple([gasRecipient], [exchangedAmount], gasExchangeFee, {
          from: gasExchangeManager,
        }),
      ).to.rejectedWith("SEX_OLD_RATE");
    });

    // there is permanent allowance but still investor can increase  allowance by `approve` on euro token
    // gasExchange (in fact euro token controller) should disregard that
    // IMO this will fail. I didn't take such case into account
    it("should revert on exchange bigger than permanent allowance if investor increased allowance", async () => {
      const exchangedAmountMoreThanAllowance = gasExchangeMaxAllowanceEurUlps.plus(1);
      const rate = Q18.mul(601.65123);

      await setGasExchangeRateAndAllowance(rate, gasExchangeMaxAllowanceEurUlps);
      await depositEuroToken(gasRecipient, gasExchangeMaxAllowanceEurUlps.times(2));
      await sendEtherToExchange(_, Q18);

      await euroToken.approve(gasExchange.address, exchangedAmountMoreThanAllowance, {
        from: gasRecipient,
      });

      await expect(
        gasExchange.gasExchange(gasRecipient, exchangedAmountMoreThanAllowance, gasExchangeFee, {
          from: gasExchangeManager,
        }),
      ).to.revert;
    });

    it("should revert on multi exchange bigger than permanent allowance if investor increased allowance", async () => {
      const exchangedAmountMoreThanAllowance = gasExchangeMaxAllowanceEurUlps.plus(1);
      const rate = Q18.mul(601.65123);

      await setGasExchangeRateAndAllowance(rate, gasExchangeMaxAllowanceEurUlps);
      await depositEuroToken(gasRecipient, gasExchangeMaxAllowanceEurUlps.times(2));
      await sendEtherToExchange(_, Q18);

      await euroToken.approve(gasExchange.address, exchangedAmountMoreThanAllowance, {
        from: gasRecipient,
      });

      await expect(
        gasExchange.gasExchangeMultiple(
          [gasRecipient],
          [exchangedAmountMoreThanAllowance],
          gasExchangeFee,
          {
            from: gasExchangeManager,
          },
        ),
      ).to.revert;
    });

    it("should revert on exchange not from gasExchangeManager", async () => {
      const decimalExchangeAmount = 20;
      const exchangedAmount = Q18.mul(decimalExchangeAmount);
      const rate = Q18.mul(601.65123);

      await setGasExchangeRateAndAllowance(rate, gasExchangeMaxAllowanceEurUlps);
      await depositEuroToken(gasRecipient, Q18.mul(40));
      await sendEtherToExchange(_, Q18);

      await expect(
        gasExchange.gasExchange(gasRecipient, exchangedAmount, gasExchangeFee, {
          from: randomAddress,
        }),
      ).to.revert;
    });

    it("should revert on multiple exchange not from gasExchangeManager", async () => {
      const decimalExchangeAmount1 = 20;
      const exchangedAmount1 = Q18.mul(decimalExchangeAmount1);
      const decimalExchangeAmount2 = 17.90128;
      const exchangedAmount2 = Q18.mul(decimalExchangeAmount2);
      const rate = Q18.mul(601.65123);

      await setGasExchangeRateAndAllowance(rate, gasExchangeMaxAllowanceEurUlps);
      await depositEuroToken(gasRecipient, Q18.mul(40));
      await depositEuroToken(anotherGasRecipient, Q18.mul(40));
      await sendEtherToExchange(_, Q18);

      await expect(
        gasExchange.gasExchangeMultiple(
          [gasRecipient, anotherGasRecipient],
          [exchangedAmount1, exchangedAmount2],
          gasExchangeFee,
          {
            from: randomAddress,
          },
        ),
      ).to.revert;
    });

    it("should revert on exchange contract not having ether", async () => {
      const decimalExchangeAmount = 20;
      const exchangedAmount = Q18.mul(decimalExchangeAmount);
      const rate = Q18.mul(601.65123);

      await setGasExchangeRateAndAllowance(rate, gasExchangeMaxAllowanceEurUlps);
      await depositEuroToken(gasRecipient, Q18.mul(40));

      await expect(
        gasExchange.gasExchange(gasRecipient, exchangedAmount, gasExchangeFee, {
          from: gasExchangeManager,
        }),
      ).to.revert;
    });

    it("should revert on not having enough euroToken", async () => {
      const decimalExchangeAmount = 20;
      const exchangedAmount = Q18.mul(decimalExchangeAmount);
      const rate = Q18.mul(601.65123);

      await setGasExchangeRateAndAllowance(rate, gasExchangeMaxAllowanceEurUlps);
      await depositEuroToken(gasRecipient, Q18.mul(1)); // not enough tokens
      await sendEtherToExchange(_, Q18);

      await expect(
        gasExchange.gasExchange(gasRecipient, exchangedAmount, gasExchangeFee, {
          from: gasExchangeManager,
        }),
      ).to.revert;
    });

    it("should reclaim ether from SimpleExchange", async () => {
      const gasPrice = new web3.BigNumber(0x01);
      const etherAmount = etherToWei(10);

      await sendEtherToExchange(_, etherAmount);
      const initalBalance = await promisify(web3.eth.getBalance)(platformWallet);
      const initialExchangeBalance = await promisify(web3.eth.getBalance)(simpleExchange.address);

      await createAccessPolicy(accessPolicy, [
        {
          subject: platformWallet,
          role: roles.reclaimer,
          object: simpleExchange.address,
        },
      ]);

      await identityRegistry.setClaims(platformWallet, "0", hasKYCandHasAccount, {
        from: admin,
      });

      const tx = await simpleExchange.reclaim(ZERO_ADDRESS, {
        from: platformWallet,
        gasPrice,
      });
      const gasCost = gasPrice.mul(tx.receipt.gasUsed);

      const exchangeBalaceAfter = await promisify(web3.eth.getBalance)(simpleExchange.address);
      expect(exchangeBalaceAfter).to.be.bignumber.eq(0);

      const expectedBalance = initalBalance.plus(initialExchangeBalance).minus(gasCost);
      const balanceAfter = await promisify(web3.eth.getBalance)(platformWallet);
      expect(balanceAfter).to.be.bignumber.eq(expectedBalance);
    });

    async function setGasExchangeRateAndAllowance(rate, allowanceEurUlps) {
      await gasExchange.setExchangeRate(etherToken.address, euroToken.address, rate, {
        from: tokenOracleManager,
      });
      await euroTokenController.applySettings(0, 0, allowanceEurUlps, { from: admin });
    }

    async function depositEuroToken(recipient, amount) {
      await identityRegistry.setClaims(recipient, "0", hasKYCandHasAccount, {
        from: admin,
      });
      await euroToken.deposit(recipient, amount, 0x0, { from: admin });
    }

    async function sendEtherToExchange(sender, amount) {
      const tx = await gasExchange.send(amount, { from: sender });
      expectLogReceivedEther(tx, sender, amount, amount);
      const balanceAfter = await promisify(web3.eth.getBalance)(gasExchange.address);
      expect(balanceAfter).to.be.bignumber.eq(amount);
    }

    async function reclaimEuroFromExchange(recipient) {
      await createAccessPolicy(accessPolicy, [
        {
          subject: recipient,
          role: roles.reclaimer,
          object: gasExchange.address,
        },
      ]);
      await identityRegistry.setClaims(recipient, "0", hasKYCandHasAccount, {
        from: admin,
      });
      return simpleExchange.reclaim(euroToken.address, { from: recipient });
      // TODO: Check
    }

    async function reclaimEtherFromExchange(recipient) {
      await createAccessPolicy(accessPolicy, [
        {
          subject: recipient,
          role: roles.reclaimer,
          object: gasExchange.address,
        },
      ]);
      await identityRegistry.setClaims(recipient, "0", hasKYCandHasAccount, {
        from: admin,
      });
      return simpleExchange.reclaim(etherToken.address, { from: recipient });
    }

    function expectLogSetExchangeRate(event, numToken, denToken, rate) {
      expect(event.event).to.eq("LogSetExchangeRate");
      expect(event.args.numeratorToken).to.eq(numToken);
      expect(event.args.denominatorToken).to.eq(denToken);
      expect(event.args.rate).to.be.bignumber.eq(rate);
    }

    function expectLogReceivedEther(tx, sender, amount, balance) {
      const event = eventValue(tx, "LogReceivedEther");
      expect(event).to.exist;
      expect(event.args.sender).to.eq(sender);
      expect(event.args.amount).to.be.bignumber.eq(amount);
      expect(event.args.balance).to.be.bignumber.eq(balance);
    }

    function expectLogGasExchange(event, recipient, exchangedAmount, fee, expectedWei, rate) {
      expect(event.event).to.eq("LogGasExchange");
      expect(event.args.gasRecipient).to.eq(recipient);
      expect(event.args.amountEurUlps).to.be.bignumber.eq(exchangedAmount);
      expect(event.args.exchangeFeeFrac).to.be.bignumber.eq(fee);
      expect(event.args.amountWei).to.be.bignumber;
      expect(event.args.amountWei.sub(expectedWei).abs()).to.be.bignumber.lt(10);
      expect(event.args.rate).to.be.bignumber.eq(rate);
    }
  },
);
