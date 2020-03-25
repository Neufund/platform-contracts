pragma solidity 0.4.26;

import "./ESOPTypes.sol";
import "./EmployeesList.sol";
import "./OptionsCalculator.sol";
import "../../../Math.sol";
import "../../../Universe.sol";
import "../../../Agreement.sol";
// import "./CodeUpdateable.sol";
import "./IESOPOptionsConverter.sol";
// import './ESOPMigration.sol';


contract ESOP is
    ESOPTypes,
    Math,
    Agreement,
    EmployeesList,
    OptionsCalculator
{
    ////////////////////////
    // Types
    ////////////////////////

    enum ESOPState {
        New,
        Open,
        Conversion,
        Migrated
    }

    enum TerminationType {
        Regular,
        BadLeaver
    }


    ////////////////////////
    // Events
    ////////////////////////


    // esop offered to employee
    event LogEmployeeOffered(
        address company,
        address indexed employee,
        uint96 poolOptions,
        uint96 extraOptions
    );

    // employee accepted offer
    event LogEmployeeSignedToESOP(
        address company,
        address indexed employee,
        uint96 poolOptions,
        uint96 extraOptions
    );

    event LogEmployeeExtraOptionsIncreased(
        address company,
        address indexed employee,
        uint96 extraOptions
    );

    // employee rejected offer
    /*event EmployeeRejectedESOP(
        address company,
        address indexed employee
    );*/

    // employee suspended
    event LogEmployeeSuspended(
        address indexed employee,
        uint32 suspendedAt
    );

    // employee resumed
    event LogEmployeeResumed(
        address indexed employee,
        uint32 continuedAt,
        uint32 suspendedPeriod
    );

    // employee terminated by company
    event LogEmployeeTerminated(
        address company,
        address indexed employee,
        uint32 terminatedAt,
        TerminationType termType
    );

    // conversion exercised
    event LogEmployeeExercisedOptions(
        address indexed employee,
        address exercisedFor,
        uint256 totalOptions,
        uint256 bonusOptions,
        uint256 convertedOptions,
        bool isFinalConversion
    );


    // esop was opened for particular company, converter and pool sizes
    event LogESOPOpened(
        address company,
        address converter,
        uint256 totalPoolOptions,
        uint256 totalExtraOptions,
        string optionsAgreementUrl
    );
    // options conversion was offered with particular conversion agreement
    event LogOptionsConversionOffered(
        address company,
        address converter,
        uint32 convertedAt,
        uint32 exercisePeriodDeadline,
        uint256 bonusOptions,
        string conversionAgreementUrl,
        bool closeESOP
    );
    // extra options pool was reset
    event LogESOPExtraPoolSet(
        uint256 totalExtraPool
    );

    ////////////////////////
    // Immutable state
    ////////////////////////

    // ipfs hash of document establishing this ESOP
    // bytes public ESOPLegalWrapperIPFSHash;

    // company representative address
    address public COMPANY_LEGAL_REPRESENTATIVE;
    // token controller address which is also root of trust
    IESOPOptionsConverter public ESOP_OPTIONS_CONVERTER;
    // default period for employee signature
    uint32 constant public MINIMUM_MANUAL_SIGN_PERIOD = 2 weeks;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // total poolOptions in The Pool
    uint256 private _totalPoolOptions;
    // total extra options in the pool
    uint256 private _totalExtraOptions;
    // total bonus options established optionally on final conversion
    uint256 private _totalBonusOptions;
    // poolOptions that remain to be assigned
    uint256 private _remainingPoolOptions;
    // assigned extra options
    uint256 private _assignedExtraOptions;
    // assigned bonus pool
    uint256 private _assignedBonusOptions;
    // all converted options
    uint256 private _exercisedOptions;

    // state of ESOP
    ESOPState private _esopState; // automatically sets to New (0)

    // when conversion event happened
    uint32 private _conversionOfferedAt;
    // employee conversion deadline
    uint32 private _exerciseOptionsDeadline;
    // conversion agreement
    string private _optionsConversionOfferUrl;
    // says if conversion is final
    bool private _isFinalConversion;

    ////////////////////////
    // Modifiers
    ////////////////////////

    modifier withEmployee(address e) {
        // will throw on unknown address
        require(hasEmployee(e), "NF_ESOP_EMPLOYEE_NOT_EXISTS");
        _;
    }

    modifier onlyESOPNew() {
        require(_esopState == ESOPState.New, "NF_ESOP_ONLY_NEW");
        _;
    }

    modifier onlyESOPOpen() {
        // esop is open when it's open or in partial conversion state
        require(isESOPOpen(), "NF_ESOP_ONLY_OPEN");
        _;
    }

    modifier onlyESOPConverting() {
        require(_esopState == ESOPState.Conversion, "NF_ESOP_ONLY_NEW");
        _;
    }

    modifier onlyLegalRep() {
        require(COMPANY_LEGAL_REPRESENTATIVE == msg.sender, "NF_ESOP_ONLY_COMPANY");
        _;
    }

    modifier onlyOptionsConverter() {
        require(ESOP_OPTIONS_CONVERTER == msg.sender, "NF_ESOP_ONLY_CONVERTER");
        _;
    }

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        address companyLegalRep,
        IESOPOptionsConverter optionsConverter,
        uint32 cliffPeriod,
        uint32 vestingPeriod,
        uint256 residualAmountFrac,
        uint256 bonusOptionsFrac,
        uint256 newEmployeePoolFrac,
        uint256 optionsPerShareCapitalUnit,
        uint256 strikePriceEurUlps
    )
        public
        Agreement(universe.accessPolicy(), universe.forkArbiter())
    {
        require(residualAmountFrac <= DECIMAL_POWER, "NF_ESOP_RESIDUAL_AMOUNT");
        require(bonusOptionsFrac <= DECIMAL_POWER, "NF_ESOP_BONUS_OPTIONS");
        require(newEmployeePoolFrac <= DECIMAL_POWER, "NF_ESOP_NEW_EMPLOYEE_FRAC");
        require(optionsPerShareCapitalUnit > 0, "NF_ESOP_OPTIONS_PER_SHARE");
        require(cliffPeriod <= vestingPeriod, "NF_ESOP_CLIFF_PERIOD");

        //esopState = ESOPState.New; // thats initial value
        COMPANY_LEGAL_REPRESENTATIVE = companyLegalRep;
        ESOP_OPTIONS_CONVERTER = optionsConverter;
        CLIFF_PERIOD = cliffPeriod;
        VESTING_PERIOD = vestingPeriod;
        MAX_FADEOUT_FRAC = DECIMAL_POWER - residualAmountFrac;
        BONUS_OPTIONS_FRAC = bonusOptionsFrac;
        NEW_EMPLOYEE_POOL_FRAC = newEmployeePoolFrac;
        // number of indivisible options representing 1 unit of share capital
        OPTIONS_PER_SHARE_CAPITAL_UNIT = optionsPerShareCapitalUnit;
        STRIKE_PRICE_EUR_ULPS = strikePriceEurUlps;
    }



    ////////////////////////
    // Public Methods
    ////////////////////////

    function removeEmployeesWithExpiredSignaturesAndReturnFadeout()
        public
        onlyESOPOpen
    {
        // removes employees that didn't sign and sends their poolOptions back to the pool
        // computes fadeout for terminated employees and returns it to pool
        // we let anyone to call that method and spend gas on it
        address[] storage addresses = loadEmployeeAddresses();
        uint32 ct = uint32(now);
        for (uint i = 0; i < addresses.length; i++) {
            address ea = addresses[i];
            if (ea != address(0)) { // address(0) is deleted employee
                Employee storage emp = loadEmployee(ea);
                // remove employees with expired signatures
                if (emp.state == EmployeeState.WaitingForSignature && ct > emp.timeToSign) {
                    _remainingPoolOptions += distributeAndReturnToPool(emp.poolOptions, i + 1);
                    _assignedExtraOptions -= emp.extraOptions;
                    // actually this just sets address to 0 so iterator can continue
                    removeEmployee(ea);
                    continue;
                }
                // return fadeout to pool
                if (emp.state == EmployeeState.Terminated && ct > emp.fadeoutStarts) {
                    (uint96 returnedPoolOptions, uint96 returnedExtraOptions) = calculateFadeoutToPool(emp, ct);
                    if (returnedPoolOptions > 0 || returnedExtraOptions > 0) {
                        // storage pointer - we write to storage
                        emp.fadeoutStarts = ct;
                        // options from fadeout are not distributed to other employees but returned to pool
                        _remainingPoolOptions += returnedPoolOptions;
                        // we maintain extraPool for easier statistics
                        _assignedExtraOptions -= returnedExtraOptions;
                    }
                }
            }
        }
    }

    // can only by executed by option conversion contract which is token controller
    // totalPoolOptions + totalExtraOptions should correspond to authorized capital established in token controller
    // options will be assigned from totalPoolOptions and totalExtraOptions
    function openESOP(uint256 totalPoolOptions, uint256 totalExtraOptions, string optionsAgreementUrl)
        public
        onlyOptionsConverter
        onlyESOPNew
    {
        // pools must have sizes of whole share capital units
        require(totalPoolOptions % OPTIONS_PER_SHARE_CAPITAL_UNIT == 0, "NF_ESOP_POOL_ROUND");
        require(totalExtraOptions % OPTIONS_PER_SHARE_CAPITAL_UNIT == 0, "NF_ESOP_POOL_ROUND");
        // initialize pools
        _totalPoolOptions = totalPoolOptions;
        _remainingPoolOptions = totalPoolOptions;
        _totalExtraOptions = _totalExtraOptions;
        // open esop
        _esopState = ESOPState.Open;
        // sign agreement
        amendAgreement(optionsAgreementUrl);
        // compute maximum bonus options and modify FRAC to have round share capital
        (MAXIMUM_BONUS_OPTIONS, BONUS_OPTIONS_FRAC) = calculateMaximumBonusOptions(totalPoolOptions);

        emit LogESOPOpened(
            COMPANY_LEGAL_REPRESENTATIVE,
            ESOP_OPTIONS_CONVERTER,
            totalPoolOptions,
            totalExtraOptions,
            optionsAgreementUrl);
    }

    // can increase extra pool by options converter, so company governance needs to check out
    function setTotalExtraPool(uint256 totalExtraOptions)
        public
        onlyOptionsConverter
        onlyESOPOpen
    {
        require(totalExtraOptions >= _assignedExtraOptions, "NF_ESOP_CANNOT_DECREASE_EXTRA_POOL_BELOW");
        require(totalExtraOptions % OPTIONS_PER_SHARE_CAPITAL_UNIT == 0, "NF_ESOP_POOL_ROUND");

        _totalExtraOptions = totalExtraOptions;
        emit LogESOPExtraPoolSet(totalExtraOptions);
    }

    // implement same migration as PlaceholderController
    // function m();


    function offerOptionsToEmployee(address e, uint32 issueDate, uint32 timeToSign, uint96 extraOptions, bool poolCleanup)
        public
        onlyESOPOpen
        onlyLegalRep
    {
        if (poolCleanup) {
            // recover poolOptions for employees with expired signatures
            // return fade out to pool
            removeEmployeesWithExpiredSignaturesAndReturnFadeout();
        }
        offerOptionsPrivate(e, issueDate, timeToSign, extraOptions, true);
    }

    function offerOptionsToEmployeeOnlyExtra(address e, uint32 issueDate, uint32 timeToSign, uint96 extraOptions)
        public
        onlyESOPOpen
        onlyLegalRep
    {
        offerOptionsPrivate(e, issueDate, timeToSign, extraOptions, false);
    }

    function increaseEmployeeExtraOptions(address e, uint96 extraOptions)
        public
        onlyESOPOpen
        onlyLegalRep
        withEmployee(e)
    {
        Employee storage emp = loadEmployee(e);
        require(emp.state == EmployeeState.Employed || emp.state == EmployeeState.WaitingForSignature, "NF_ESOP_EMPLOYEE_INVALID_STATE");
        //this will save storage
        emp.extraOptions += extraOptions;
        // issue extra options
        issueExtraOptions(extraOptions);
        emit LogEmployeeExtraOptionsIncreased(e, COMPANY_LEGAL_REPRESENTATIVE, extraOptions);
    }

    function employeeSignsToESOP()
        public
        withEmployee(msg.sender)
        onlyESOPOpen
    {
        Employee storage emp = loadEmployee(msg.sender);
        require(emp.state == EmployeeState.WaitingForSignature, "NF_ESOP_EMPLOYEE_INVALID_STATE");
        require(now <= emp.timeToSign, "NF_ESOP_SIGNS_TOO_LATE");

        emp.state = EmployeeState.Employed;
        emit LogEmployeeSignedToESOP(COMPANY_LEGAL_REPRESENTATIVE, msg.sender, emp.poolOptions, emp.extraOptions);
    }

    function toggleEmployeeSuspension(address e, uint32 toggledAt)
        external
        onlyESOPOpen
        onlyLegalRep
        withEmployee(e)
    {
        Employee storage emp = loadEmployee(e);
        require(emp.state == EmployeeState.Employed, "NF_ESOP_EMPLOYEE_INVALID_STATE");

        if (emp.suspendedAt == 0) {
            //suspend action
            emp.suspendedAt = toggledAt;
            emit LogEmployeeSuspended(e, toggledAt);
        } else {
            require(emp.suspendedAt <= toggledAt, "NF_ESOP_SUSPENDED_TOO_LATE");
            uint32 suspendedPeriod = toggledAt - emp.suspendedAt;
            // move everything by suspension period by changing issueDate
            emp.issueDate += suspendedPeriod;
            emp.suspendedAt = 0;
            emit LogEmployeeResumed(e, toggledAt, suspendedPeriod);
        }
    }

    function terminateEmployee(address e, uint32 terminatedAt, uint8 terminationType)
        external
        onlyESOPOpen
        onlyLegalRep
        withEmployee(e)
    {
        // terminates an employee
        TerminationType termType = TerminationType(terminationType);
        Employee storage emp = loadEmployee(e);
        // check termination time against issueDate
        require(terminatedAt >= emp.issueDate, "NF_ESOP_CANNOT_TERMINATE_BEFORE_ISSUE");

        if (emp.state == EmployeeState.WaitingForSignature) {
            termType = TerminationType.BadLeaver;
        } else {
            // must be employed
            require(emp.state == EmployeeState.Employed, "NF_ESOP_EMPLOYEE_INVALID_STATE");
        }
        // how many poolOptions returned to pool
        uint96 returnedOptions;
        uint96 returnedExtraOptions;
        if (termType == TerminationType.Regular) {
            // regular termination, compute suspension
            if (emp.suspendedAt > 0 && emp.suspendedAt < terminatedAt)
                emp.issueDate += terminatedAt - emp.suspendedAt;
            // vesting applies
            returnedOptions = emp.poolOptions - calculateVestedOptions(terminatedAt, emp.issueDate, emp.poolOptions);
            returnedExtraOptions = emp.extraOptions - calculateVestedOptions(terminatedAt, emp.issueDate, emp.extraOptions);
            terminateEmployee(e, emp.issueDate, terminatedAt, terminatedAt, EmployeeState.Terminated);
        } else if (termType == TerminationType.BadLeaver) {
            // bad leaver - employee is kicked out from ESOP, return all poolOptions
            returnedOptions = emp.poolOptions;
            returnedExtraOptions = emp.extraOptions;
            removeEmployee(e);
        }
        _remainingPoolOptions += distributeAndReturnToPool(returnedOptions, emp.idx);
        _assignedExtraOptions -= returnedExtraOptions;
        emit LogEmployeeTerminated(e, COMPANY_LEGAL_REPRESENTATIVE, terminatedAt, termType);
    }

    // offer options conversion to employees and possibly close ESOP if this is final conversion
    // final conversion forces converting all options into shares/tokens/money in given deadline
    // non final (partial) conversion let's employees to choose % options converted and ESOP still continues
    // conversion happens in token controller and requires signing optionsConversionOfferUrl
    // bonus pool corresponding to additional authorized capital is offered for accel vesting bonus, if offered must match total optional bonus
    // if bonus pool is 0, it's assumed that it's a future commitment without assigned authorized capital that will be converted
    function offerOptionsConversion(uint32 exerciseOptionsDeadline, uint256 bonusPool, string optionsConversionOfferUrl, bool closeESOP)
        public
        onlyESOPOpen
        onlyOptionsConverter
    {
        uint32 offerMadeAt = uint32(now);
        require(exerciseOptionsDeadline - offerMadeAt >= MINIMUM_MANUAL_SIGN_PERIOD, "NF_ESOP_CONVERSION_PERIOD_TOO_SHORT");
        require(bonusPool > 0 && closeESOP, "NF_BONUS_POOL_ONLY_ON_CLOSE");
        require(bonusPool == 0 || bonusPool == MAXIMUM_BONUS_OPTIONS, "NF_ESOP_BONUS_OPTIONS_MISMATCH");
        // return to pool everything we can
        removeEmployeesWithExpiredSignaturesAndReturnFadeout();

        _totalBonusOptions = bonusPool;
        _conversionOfferedAt = offerMadeAt;
        _exerciseOptionsDeadline = exerciseOptionsDeadline;
        _esopState = ESOPState.Conversion;
        _optionsConversionOfferUrl = optionsConversionOfferUrl;
        // from now vesting and fadeout stops, no new employees may be added
        _isFinalConversion = closeESOP;

        emit LogOptionsConversionOffered(
            COMPANY_LEGAL_REPRESENTATIVE,
            ESOP_OPTIONS_CONVERTER,
            offerMadeAt,
            exerciseOptionsDeadline,
            bonusPool,
            optionsConversionOfferUrl,
            closeESOP
        );
    }

    // final conversion is executed by employee and bonus options can be triggered via agreeToAcceleratedVestingBonusConditions
    // accelerated vesting will be applied
    function employeeFinalExerciseOptions(bool agreeToAcceleratedVestingBonusConditions)
        public
        onlyOptionsConverter
        withEmployee(msg.sender)
    {
        require(now <= _exerciseOptionsDeadline, "NF_ESOP_CONVERSION_TOO_LATE");
        // no accelerated vesting before final conversion
        require(_isFinalConversion, "NF_ESOP_NOT_FINAL_CONV");
        // convert employee in its own name
        exerciseOptionsInternal(uint32(now), msg.sender, msg.sender, DECIMAL_POWER, !agreeToAcceleratedVestingBonusConditions);
    }

    // partial conversion is executed and accelerated vesting is not applied so it happens from already vested options
    // employee may choose to convert less options than all that is vested
    // token controller performing conversion may further limit the number options converted - that is returned as convertedOptions
    function employeePartialExerciseOptions(uint256 exercisedOptionsFrac)
        public
        onlyOptionsConverter
        withEmployee(msg.sender)
        returns(uint256 convertedOptions)
    {
        require(now <= _exerciseOptionsDeadline, "NF_ESOP_CONVERSION_TOO_LATE");
        // partial conversion only in non final
        require(!_isFinalConversion, "NF_ESOP_NOT_PARTIAL_CONV");
        // make sure frac is within 0-100%
        assert(exercisedOptionsFrac > 0 && exercisedOptionsFrac <= DECIMAL_POWER);
        // convert employee in its own name
        return exerciseOptionsInternal(uint32(now), msg.sender, msg.sender, exercisedOptionsFrac, true);
    }

    function employeeDenyExerciseOptions()
        public
        onlyOptionsConverter
        withEmployee(msg.sender)
    {
        require(now <= _exerciseOptionsDeadline, "NF_ESOP_CONVERSION_TOO_LATE");
        require(_isFinalConversion, "NF_ESOP_CANNOT_DENY_NONFINAL_C");

        // marks as fully converted, releasing authorized capital but not getting real shares
        Employee storage emp = loadEmployee(msg.sender);
        require(emp.state != EmployeeState.OptionsExercised, "NF_ESOP_EMPLOYEE_ALREADY_EXERCISED");
        // mark as converted - that's terminal state
        (uint96 pool, uint96 extra, uint96 bonus) = calculateOptionsComponents(
            emp,
            uint32(now),
            _conversionOfferedAt,
            true
        );
        assert(bonus == 0);
        emp.exercisedOptions = pool + extra;
        emp.state = EmployeeState.OptionsExercised;
        // increase exercised options pool
        _exercisedOptions += pool + extra;
        emit LogEmployeeExercisedOptions(msg.sender, address(0), pool + extra, 0, pool + extra, true);
    }

    function exerciseExpiredEmployeeOptions(address e, bool disableAcceleratedVesting)
        public
        onlyOptionsConverter
        onlyLegalRep
        withEmployee(e)
        returns (uint256 convertedOptions)
    {
        // company can convert options for any employee that did not converted (after deadline)
        require(_isFinalConversion, "NF_ESOP_CANNOT_TAKE_EXPIRED_NONFINAL_C");
        // legal rep will hold tokens and get eventual payout
        return exerciseOptionsInternal(uint32(now), e, COMPANY_LEGAL_REPRESENTATIVE, DECIMAL_POWER, disableAcceleratedVesting);
    }

    function calcEffectiveOptionsForEmployee(address e, uint32 calcAtTime)
        public
        constant
        withEmployee(e)
        returns (uint)
    {
        // only final conversion stops vesting
        uint32 conversionOfferedAt = _isFinalConversion ? _conversionOfferedAt : 0;
        Employee memory emp = loadEmployee(e);
        return calculateOptions(emp, calcAtTime, conversionOfferedAt, false);
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        // neufund-platform:ESOP
        return (0xd4407ab22b0688495bf10d43a119a766b8d16095a1ec9b4678dcc3ee0cb082ea, 0);
    }



    //
    // Getters
    //

    // returns amount of authorized capital represented by all pools
    function getAuthorizedCapital() public constant returns (uint256) {
        return calculateAuthorizedCapital(_totalPoolOptions + _totalExtraOptions + _totalBonusOptions);
    }

    // returns amount of authorized capital assigned to employees
    function getAssignedAuthorizedCapital() public constant returns (uint256) {
        uint256 assigned = _totalPoolOptions - _remainingPoolOptions + _assignedExtraOptions + _assignedBonusOptions;
        return calculateAuthorizedCapital(assigned);
    }

    // returns amount of authorized capital exercised by employees
    // if conversion to equity token happens that amount of authorized capital is now assigned to nominee
    function getExercisedAuthorizedCapital() public constant returns (uint256) {
        return calculateAuthorizedCapital(_exercisedOptions);
    }

    function getPoolsInfo()
        public
        constant
        returns (
            uint256 totalPoolOptions,
            uint256 totalExtraOptions,
            uint256 totalBonusOptions,
            uint256 remainingPoolOptions,
            uint256 assignedExtraOptions,
            uint256 assignedBonusOptions,
            uint256 exercisedOptions
        )
    {
        return (
            _totalPoolOptions,
            _totalExtraOptions,
            _totalBonusOptions,
            _remainingPoolOptions,
            _assignedExtraOptions,
            _assignedBonusOptions,
            _exercisedOptions
        );
    }

    function esopState() public constant returns (ESOPState) {
        return isESOPOpen() ? ESOPState.Open : _esopState;
    }

    function getConversionInfo()
        public
        constant
        returns (
            uint32 conversionOfferedAt,
            uint32 exerciseOptionsDeadline,
            string optionsConversionOfferUrl,
            bool isFinalConversion
        )
    {
        return (
            _conversionOfferedAt,
            _exerciseOptionsDeadline,
            _optionsConversionOfferUrl,
            _isFinalConversion
        );
    }

    ////////////////////////
    // Internal Methods
    ////////////////////////


    //
    // Overrides Agreement internal interface
    //

    function mCanAmend(address legalRepresentative)
        internal
        returns (bool)
    {
        // options converter or company legal rep can change agreement
        return legalRepresentative == address(ESOP_OPTIONS_CONVERTER) || legalRepresentative == COMPANY_LEGAL_REPRESENTATIVE;
    }

    ////////////////////////
    // Private Methods
    ////////////////////////

    function distributeAndReturnToPool(uint256 distributedOptions, uint idx)
        private
        returns (uint256 optionsLeft)
    {
        // enumerate all employees that were offered poolOptions after than fromIdx -1 employee
        address[] storage addresses = loadEmployeeAddresses();
        optionsLeft = distributedOptions;
        for (uint256 i = idx; i < addresses.length; i++) {
            address ea = addresses[i];
            if (ea != 0) { // address(0) is deleted employee
                Employee storage emp = loadEmployee(ea);
                // skip employees with no poolOptions and terminated employees
                uint96 empPoolOptions = emp.poolOptions;
                if (empPoolOptions > 0 && ( emp.state == EmployeeState.WaitingForSignature || emp.state == EmployeeState.Employed) ) {
                    uint96 newoptions = calcNewEmployeePoolOptions(optionsLeft);
                    // emp is a storage so write happens here
                    emp.poolOptions = empPoolOptions + newoptions;
                    optionsLeft -= newoptions;
                }
            }
        }
    }

    function exerciseOptionsInternal(
        uint32 calcAtTime,
        address employee,
        address exerciseFor,
        uint256 exercisedOptionsFrac,
        bool disableAcceleratedVesting
    )
        private
        returns (uint256 convertedOptions)
    {
        Employee storage emp = loadEmployee(employee);
        EmployeeState prevState = emp.state;
        require(prevState != EmployeeState.OptionsExercised, "NF_ESOP_EMPLOYEE_ALREADY_EXERCISED");

        // non final conversion is not a real conversion
        uint32 conversionOfferedAt = _isFinalConversion ? _conversionOfferedAt : 0;
        // calculate conversion options
        (uint256 pool, uint256 extra, uint96 bonus) = calculateOptionsComponents(
            emp,
            calcAtTime,
            conversionOfferedAt,
            disableAcceleratedVesting
        );
        // allow to convert less than amount above, bonus does not participate
        if (exercisedOptionsFrac < DECIMAL_POWER) {
            pool = decimalFraction(pool, exercisedOptionsFrac);
            extra = decimalFraction(extra, exercisedOptionsFrac);
        }
        // total converted options cannot cross max pools - assigned pools
        uint256 totalNonConverted = _totalPoolOptions - _remainingPoolOptions + _assignedExtraOptions +
            _assignedBonusOptions - _exercisedOptions;
        // exercise options in the name of employee and assign those to exerciseFor
        convertedOptions = ESOP_OPTIONS_CONVERTER.exerciseOptions(
            exerciseFor,
            pool,
            extra,
            bonus,
            emp.exercisedOptions,
            OPTIONS_PER_SHARE_CAPITAL_UNIT
        );
        if (_isFinalConversion) {
            convertedOptions = pool + extra;
            // assign only if bonus pool established
            if (_totalBonusOptions > 0) {
                _assignedBonusOptions += bonus;
                convertedOptions += bonus;
            }
        } else {
            // cannot convert more than max shares
            require(convertedOptions <= pool + extra, "NF_ESOP_CONVERSION_OVERFLOW");
        }
        assert(convertedOptions < 2**96);
        // we cannot convert more options than were assigned
        require(convertedOptions <= totalNonConverted, "NF_ESOP_CANNOT_CONVERT_UNAUTHORIZED");
        _exercisedOptions += convertedOptions;
        // write user
        emp.state = _isFinalConversion ? EmployeeState.OptionsExercised : prevState;
        emp.exercisedOptions = uint96(convertedOptions);
        emit LogEmployeeExercisedOptions(employee, exerciseFor, uint96(pool + extra), bonus, convertedOptions, _isFinalConversion);
    }

    function offerOptionsPrivate(address e, uint32 issueDate, uint32 timeToSign, uint96 extraOptions, bool usePool)
        internal
    {
        // do not add twice
        require(!hasEmployee(e), "NF_ESOP_EMPLOYEE_EXISTS");
        require(now + MINIMUM_MANUAL_SIGN_PERIOD >= timeToSign, "NF_ESOP_NO_TIME_TO_SIGN");

        uint96 poolOptions;
        if (usePool) {
            poolOptions = calcNewEmployeePoolOptions(_remainingPoolOptions);
            _remainingPoolOptions -= poolOptions;
        }
        if (extraOptions > 0) {
            issueExtraOptions(extraOptions);
        }
        Employee memory emp = Employee({
            issueDate: issueDate,
            timeToSign: timeToSign,
            terminatedAt: 0,
            fadeoutStarts: 0,
            poolOptions: poolOptions,
            extraOptions: extraOptions,
            exercisedOptions: 0,
            acceleratedVestingBonusTriggered: false,
            suspendedAt: 0,
            state: EmployeeState.WaitingForSignature,
            idx: 0
        });
        setEmployee(e, emp);

        emit LogEmployeeOffered(COMPANY_LEGAL_REPRESENTATIVE, e, poolOptions, extraOptions);
    }

    function issueExtraOptions(uint256 extraOptions) internal {
        require(_assignedExtraOptions + extraOptions <= _totalExtraOptions, "NF_ESOP_EXTRA_POOL_EMPTY");
        _assignedExtraOptions += extraOptions;
    }

    function isESOPOpen() internal constant returns (bool) {
        return _esopState == ESOPState.Open || (_esopState == ESOPState.Conversion && !_isFinalConversion);
    }
}
