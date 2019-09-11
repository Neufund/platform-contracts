pragma solidity 0.4.26;

import "./ICommitment.sol";
import "./ETOTerms.sol";
import "../Company/IEquityToken.sol";


/// @title default interface of commitment process
contract IETOCommitment is
    ICommitment,
    IETOCommitmentStates
{

    ////////////////////////
    // Events
    ////////////////////////

    // on every state transition
    event LogStateTransition(
        uint32 oldState,
        uint32 newState,
        uint32 timestamp
    );

    /// on a claim by invester
    ///   `investor` claimed `amount` of `assetToken` and claimed `nmkReward` amount of NEU
    event LogTokensClaimed(
        address indexed investor,
        address indexed assetToken,
        uint256 amount,
        uint256 nmkReward
    );

    /// on a refund to investor
    ///   `investor` was refunded `amount` of `paymentToken`
    /// @dev may be raised multiple times per refund operation
    event LogFundsRefunded(
        address indexed investor,
        address indexed paymentToken,
        uint256 amount
    );

    // logged at the moment of Company setting terms
    event LogTermsSet(
        address companyLegalRep,
        address etoTerms,
        address equityToken
    );

    // logged at the moment Company sets/resets Whitelisting start date
    event LogETOStartDateSet(
        address companyLegalRep,
        uint256 previousTimestamp,
        uint256 newTimestamp
    );

    // logged at the moment Signing procedure starts
    event LogSigningStarted(
        address nominee,
        address companyLegalRep,
        uint256 newShares,
        uint256 capitalIncreaseUlps
    );

    // logged when company presents signed investment agreement
    event LogCompanySignedAgreement(
        address companyLegalRep,
        address nominee,
        string signedInvestmentAgreementUrl
    );

    // logged when nominee presents and verifies its copy of investment agreement
    event LogNomineeConfirmedAgreement(
        address nominee,
        address companyLegalRep,
        string signedInvestmentAgreementUrl
    );

    // logged on refund transition to mark destroyed tokens
    event LogRefundStarted(
        address assetToken,
        uint256 totalTokenAmountInt,
        uint256 totalRewardNmkUlps
    );

    ////////////////////////
    // Public functions
    ////////////////////////

    //
    // ETOState control
    //

    // returns current ETO state
    function state() public constant returns (ETOState);

    // returns start of given state
    function startOf(ETOState s) public constant returns (uint256);

    // returns commitment observer (typically equity token controller)
    function commitmentObserver() public constant returns (IETOCommitmentObserver);

    //
    // Commitment process
    //

    /// refunds investor if ETO failed
    function refund() external;

    /// claims tokens if ETO is a success
    function claim() external;

    // initiate fees payout
    function payout() external;


    //
    // Offering terms
    //

    function etoTerms() public constant returns (ETOTerms);

    // equity token
    function equityToken() public constant returns (IEquityToken);

    // nominee
    function nominee() public constant returns (address);

    function companyLegalRep() public constant returns (address);

    /// signed agreement as provided by company and nominee
    /// is final in Claim and Payout states, may change at any moment in Signing state
    function signedInvestmentAgreementUrl() public constant returns (string);

    /// financial outcome of token offering set on Signing state transition
    /// @dev in preceding states 0 is returned
    function contributionSummary()
        public
        constant
        returns (
            uint256 newShares, uint256 capitalIncreaseEurUlps,
            uint256 additionalContributionEth, uint256 additionalContributionEurUlps,
            uint256 tokenParticipationFeeInt, uint256 platformFeeEth, uint256 platformFeeEurUlps,
            uint256 sharePriceEurUlps
        );

    /// method to obtain current investors ticket
    function investorTicket(address investor)
        public
        constant
        returns (
            uint256 equivEurUlps,
            uint256 rewardNmkUlps,
            uint256 equityTokenInt,
            uint256 sharesInt,
            uint256 tokenPrice,
            uint256 neuRate,
            uint256 amountEth,
            uint256 amountEurUlps,
            bool claimOrRefundSettled,
            bool usedLockedAccount
        );
}
