pragma solidity 0.4.23;


contract ITokenExchangeRateOracle {
    /// @notice provides actual price of 'numeratorToken' in 'denominatorToken'
    ///     returns timestamp at which price was obtained in oracle
    function getExchangeRate(address numeratorToken, address denominatorToken)
        public
        constant
        returns (uint256 rateFraction, uint256 timestamp);

    /// @notice allows to retreive multiple exchange rates in once call
    function getExchangeRates(address[] numeratorTokens, address[] denominatorTokens)
        public
        constant
        returns (uint256[] rateFractions, uint256[] timestamps);
}
