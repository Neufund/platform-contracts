pragma solidity 0.4.26;


// intended to be implemented by equity token controller that provides ESOP
contract IESOPOptionsConverter {
    /// exercise of options for given employee and amount
    /// @param employee on which address to perform conversion, mind that it could be legal rep address in case company is doing the conversion for employee that didn't show up
    /// @param poolOptions how many options from pooled options to convert
    /// @param extraOptions as above, for extra options
    /// @param bonusOptions as above, for bonus options, if > 0 it means that user agreed to accelerated vesting conditions
    /// @param exercisedOptions all options already exercised by employee
    /// @param optionsPerShareCapitalUnit how many options per share capital unit - so token conversion may be scaled
    /// @return number of options actually converted. in case of final conversion must be all exercised options
    function exerciseOptions(
        address employee,
        uint256 poolOptions,
        uint256 extraOptions,
        uint256 bonusOptions,
        uint256 exercisedOptions,
        uint256 optionsPerShareCapitalUnit)
    public
        returns(uint256 convertedOptions);
}
