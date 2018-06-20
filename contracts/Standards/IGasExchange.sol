pragma solidity 0.4.24;

import "./IERC223Token.sol";


contract IGasExchange {

    ////////////////////////
    // Events
    ////////////////////////

    /// @notice logged on eur-t to gas (ether) exchange
    /// gasRecipient obtained amountWei gas, there is additional fee of exchangeFeeEurUlps
    event LogGasExchange(
        address indexed gasRecipient,
        uint256 amountEurUlps,
        uint256 exchangeFeeFrac,
        uint256 amountWei,
        uint256 rate
    );

    event LogSetExchangeRate(
        address indexed numeratorToken,
        address indexed denominatorToken,
        uint256 rate
    );

    event LogReceivedEther(
        address sender,
        uint256 amount,
        uint256 balance
    );

    ////////////////////////
    // Public methods
    ////////////////////////

    /// @notice will exchange amountEurUlps of gasRecipient balance into ether
    /// @dev EuroTokenController has permanent allowance for gasExchange contract to make such exchange possible when gasRecipient has no Ether
    ///     (chicken and egg problem is solved). The rate from token rate oracle will be used
    ///     exchangeFeeFraction will be deduced before the exchange happens
    /// @dev you should probably apply access modifier in the implementation
    function gasExchange(address gasRecipient, uint256 amountEurUlps, uint256 exchangeFeeFraction)
        public;

    /// @notice see above. allows for batching gas exchanges
    function gasExchangeMultiple(address[] gasRecipients, uint256[] amountsEurUlps, uint256 exchangeFeeFraction)
        public;

    /// sets current euro to ether exchange rate, also sets inverse
    /// ROLE_TOKEN_RATE_ORACLE is allowed to provide rates. we do not implement decentralized oracle here
    /// there is no so actual working decentralized oracle ecosystem
    /// the closes is MakerDao Medianizer at https://etherscan.io/address/0x729D19f657BD0614b4985Cf1D82531c67569197B#code but it's still centralized and only USD/ETH
    /// Oraclize is centralized and you still need to pay fees.
    /// Gnosis does not seem to be working
    /// it seems that for Neufund investor it's best to trust Platform Operator to provide correct information, Platform is aligned via NEU and has no incentive to lie
    /// SimpleExchange is replaceable via Universe. when proper oracle is available we'll move to it
    /// @param numeratorToken token to be converted from
    /// @param denominatorToken token to be converted to
    /// @param rateFraction a decimal fraction (see Math.decimalFraction) of numeratorToken to denominatorToken
    /// example: to set rate of eur to eth you provide (euroToken, etherToken, 0.0016129032258064516129032*10**18)
    /// example: to set rate of eth to eur you provide (etherToken, euroToken, 620*10**18)
    /// @dev you should probably apply access modifier in the implementation
    function setExchangeRate(IERC223Token numeratorToken, IERC223Token denominatorToken, uint256 rateFraction)
        public;

    /// @notice see above. allows for batching gas exchanges
    /// @dev you should probably apply access modifier in the implementation
    function setExchangeRates(IERC223Token[] numeratorTokens, IERC223Token[] denominatorTokens, uint256[] rateFractions)
        public;
}
