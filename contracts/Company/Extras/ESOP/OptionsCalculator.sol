pragma solidity 0.4.26;

import "./ESOPTypes.sol";
import "../../../Math.sol";


contract OptionsCalculator is
    ESOPTypes
{
    ////////////////////////
    // Constants
    ////////////////////////

    uint256 internal constant DECIMAL_POWER = 10**18;

    ////////////////////////
    // Immutable state
    ////////////////////////

    // cliff duration in seconds
    uint256 public CLIFF_PERIOD;
    // vesting duration in seconds
    uint256 public VESTING_PERIOD;
    // maximum decimal fraction of options that can fade out
    uint256 public MAX_FADEOUT_FRAC;
    // minimal options after fadeout
    function RESIDUAL_AMOUNT_PROMILLE()
        public
        constant
        returns(uint256)
    {
        return DECIMAL_POWER - MAX_FADEOUT_FRAC;
    }

    // exit bonus decimal fraction
    uint256 public BONUS_OPTIONS_FRAC;
    // decimal fraction of unassigned poolOptions that new employee gets
    uint256 public NEW_EMPLOYEE_POOL_FRAC;
    // options per share
    uint256 public OPTIONS_PER_SHARE_CAPITAL_UNIT;
    // options strike price
    uint256 public STRIKE_PRICE_EUR_ULPS;
    // maximum bonus options that can be issued
    uint256 public MAXIMUM_BONUS_OPTIONS;

    ////////////////////////
    // Public functions
    ////////////////////////

    function simulateOptions(
        uint32 issueDate,
        uint32 terminatedAt,
        uint32 suspendedAt,
        uint8 employeeState,
        uint96 poolOptions,
        uint96 extraOptions,
        uint96 exercisedOptions,
        uint32 calcAtTime
    )
        public
        constant
        returns (uint96 )
    {
        Employee memory employee = Employee({
            issueDate: issueDate,
            timeToSign: issueDate+2 weeks,
            terminatedAt: terminatedAt,
            fadeoutStarts: terminatedAt,
            suspendedAt: suspendedAt,
            state: EmployeeState(employeeState),
            idx:1,
            poolOptions: poolOptions,
            extraOptions: extraOptions,
            exercisedOptions: exercisedOptions,
            acceleratedVestingBonusTriggered: false
            });

        return calculateOptions(employee, calcAtTime, 0, false);
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    function calcNewEmployeePoolOptions(uint256 remainingPoolOptions)
        internal
        constant
        returns (uint96)
    {
        return uint96(Math.decimalFraction(remainingPoolOptions, NEW_EMPLOYEE_POOL_FRAC));
    }

    function calculateVestedOptions(uint32 time, uint32 vestingStarts, uint96 options)
        internal
        constant
        returns (uint96 vestedOptions)
    {
        if (time <= vestingStarts) {
            return 0;
        }
        // apply vesting
        uint32 effectiveTime = time - vestingStarts;
        // if within cliff nothing is due
        if (effectiveTime < CLIFF_PERIOD) {
            return 0;
        } else {
            return  effectiveTime < VESTING_PERIOD ? uint96(Math.proportion(options, effectiveTime, VESTING_PERIOD)) : options;
        }
    }

    function applyFadeoutToOptions(
        uint32 time,
        uint32 issueDate,
        uint32 terminatedAt,
        uint96 options,
        uint96 vestedOptions
    )
        internal
        constant
        returns (uint96 fadeoutOptions)
    {
        if (time < terminatedAt) {
            return vestedOptions;
        }
        uint32 timefromTermination = time - terminatedAt;
        // fadeout duration equals to employment duration
        uint32 employmentPeriod = terminatedAt - issueDate;
        // minimum value of options at the end of fadeout, it is a % of all employee's options
        uint96 minFadeValue = uint96(Math.decimalFraction(options, DECIMAL_POWER - MAX_FADEOUT_FRAC));
        // however employee cannot have more than options after fadeout than he was vested at termination
        if (minFadeValue >= vestedOptions) {
            return vestedOptions;
        } else {
            if (timefromTermination > employmentPeriod) {
                // fadeout options at the end of fadout
                return minFadeValue;
            } else {
                uint96 toFadeout = uint96(Math.proportion(vestedOptions - minFadeValue, employmentPeriod - timefromTermination, employmentPeriod));
                // min fadeout + amount of options not yet fadeouted
                return minFadeValue + toFadeout;
            }
        }
    }

    function calculateOptionsComponents(
        Employee memory employee,
        uint32 calcAtTime,
        uint32 conversionOfferedAt,
        bool disableAcceleratedVesting
    )
        internal
        constant
        returns (uint96 vestedPoolOptions, uint96 vestedExtraOptions, uint96 bonusOptions)
    {
        // returns tuple of (vested pool options, vested extra options, bonus)
        // no options for converted options or when esop is not singed
        if (employee.state == EmployeeState.OptionsExercised || employee.state == EmployeeState.WaitingForSignature) {
            return (0,0,0);
        }
        // no options when esop is being converted and conversion deadline expired
        bool isESOPConverted = conversionOfferedAt > 0 && calcAtTime >= conversionOfferedAt; // this function time-travels
        uint96 issuedOptions = employee.poolOptions + employee.extraOptions;
        // check overflow
        assert(issuedOptions > employee.poolOptions);
        // employee with no options
        if (issuedOptions == 0) {
            return (0,0,0);
        }
        // if employee is terminated but we calc options before term, simulate employed again
        if (calcAtTime < employee.terminatedAt && employee.terminatedAt > 0) {
            employee.state = EmployeeState.Employed;
        }
        uint96 vestedOptions = issuedOptions;
        bool accelerateVesting = isESOPConverted && employee.state == EmployeeState.Employed && !disableAcceleratedVesting;
        if (!accelerateVesting) {
            // choose vesting time
            // if terminated then vesting calculated at termination
            uint32 calcVestingAt = employee.state ==
                EmployeeState.Terminated ? employee.terminatedAt :
                // if employee is supended then compute vesting at suspension time
                (employee.suspendedAt > 0 && employee.suspendedAt < calcAtTime ? employee.suspendedAt :
                // if conversion offer then vesting calucated at time the offer was made
                conversionOfferedAt > 0 ? conversionOfferedAt :
                // otherwise use current time
                calcAtTime);
            vestedOptions = calculateVestedOptions(calcVestingAt, employee.issueDate, issuedOptions);
        }
        // calc fadeout for terminated employees
        if (employee.state == EmployeeState.Terminated) {
            // use conversion event time to compute fadeout to stop fadeout on conversion IF not after conversion date
            vestedOptions = applyFadeoutToOptions(
                isESOPConverted ? conversionOfferedAt : calcAtTime,
                employee.issueDate,
                employee.terminatedAt,
                issuedOptions,
                vestedOptions
            );
        }
        (vestedPoolOptions, vestedExtraOptions) = extractVestedOptionsComponents(employee.poolOptions, employee.extraOptions, vestedOptions);
        // if (vestedPoolOptions + vestedExtraOptions != vestedOptions) throw;
        return  (
            vestedPoolOptions,
            vestedExtraOptions,
            accelerateVesting ? uint96(Math.decimalFraction(vestedPoolOptions, BONUS_OPTIONS_FRAC)) : 0 );
    }

    function calculateOptions(
        Employee memory employee,
        uint32 calcAtTime,
        uint32 conversionOfferedAt,
        bool disableAcceleratedVesting
    )
        internal
        constant
        returns (uint96 allOptions)
    {
        (uint96 vestedPoolOptions, uint96 vestedExtraOptions, uint96 bonus) = calculateOptionsComponents(
            employee,
            calcAtTime,
            conversionOfferedAt,
            disableAcceleratedVesting);

        allOptions = vestedPoolOptions + vestedExtraOptions + bonus;
        // TODO: this can overflow twice
        assert(allOptions > vestedPoolOptions + vestedExtraOptions + bonus);
        return allOptions;
    }

    function extractVestedOptionsComponents(uint96 issuedPoolOptions, uint96 issuedExtraOptions, uint96 vestedOptions)
        internal
        pure
        returns (uint96 poolVestedOptions, uint96 extraVestedOptions)
    {
        // breaks down vested options into pool options and extra options components
        if (issuedExtraOptions == 0) {
            return (vestedOptions, 0);
        }
        poolVestedOptions = uint96(Math.proportion(issuedPoolOptions, vestedOptions, issuedPoolOptions + issuedExtraOptions));
        extraVestedOptions = vestedOptions - poolVestedOptions;
    }

    function calculateFadeoutToPool(Employee memory employee, uint32 time)
        internal
        constant
        returns (uint96 returnedPoolOptions, uint96 returnedExtraOptions)
    {
        uint96 vestedOptions = calculateVestedOptions(employee.terminatedAt, employee.issueDate, employee.poolOptions);
        returnedPoolOptions = applyFadeoutToOptions(
            employee.fadeoutStarts,
            employee.issueDate,
            employee.terminatedAt,
            employee.poolOptions,
            vestedOptions) - applyFadeoutToOptions(
                time,
                employee.issueDate,
                employee.terminatedAt,
                employee.poolOptions,
                vestedOptions
            );
        uint96 vestedExtraOptions = calculateVestedOptions(employee.terminatedAt, employee.issueDate, employee.extraOptions);
        returnedExtraOptions = applyFadeoutToOptions(
            employee.fadeoutStarts,
            employee.issueDate,
            employee.terminatedAt,
            employee.extraOptions,
            vestedExtraOptions) - applyFadeoutToOptions(
                time,
                employee.issueDate,
                employee.terminatedAt,
                employee.extraOptions,
                vestedExtraOptions
            );

        return (returnedPoolOptions, returnedExtraOptions);
    }

    function calculateMaximumBonusOptions(uint256 totalPoolOptions)
        internal
        constant
        returns(uint256 maximumBonusOptions, uint256 correctedBonusFrac)
    {
        maximumBonusOptions = Math.decimalFraction(totalPoolOptions, BONUS_OPTIONS_FRAC);
        correctedBonusFrac = BONUS_OPTIONS_FRAC;
        uint256 r = maximumBonusOptions % OPTIONS_PER_SHARE_CAPITAL_UNIT;
        if (r > 0) {
            // compute corrected FRAC so we generate round number of bonus capital, subtr 1 so we never overflow
            correctedBonusFrac = Math.proportion(maximumBonusOptions + r, DECIMAL_POWER, BONUS_OPTIONS_FRAC) - 1;
        }
    }

    function calculateAuthorizedCapital(uint256 options)
        internal
        constant
        returns(uint256)
    {
        return options * OPTIONS_PER_SHARE_CAPITAL_UNIT * DECIMAL_POWER;
    }
}
