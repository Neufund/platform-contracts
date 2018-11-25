pragma solidity 0.4.25;


import "./IEquityToken.sol";
import "../PlatformTerms.sol";
import "../ETO/ETOTerms.sol";
import "../Agreement.sol";
import "../Universe.sol";
import "../Reclaimable.sol";
import "../Snapshot/Daily.sol";
import "../SnapshotToken/Helpers/TokenMetadata.sol";
import "../SnapshotToken/StandardSnapshotToken.sol";
import "../Standards/IERC223Token.sol";
import "../Standards/IERC223Callback.sol";
import "../Standards/IContractId.sol";
import "../IsContract.sol";
import "../Math.sol";


contract EquityToken is
    IEquityToken,
    IContractId,
    StandardSnapshotToken,
    Daily,
    TokenMetadata,
    Agreement,
    IsContract,
    Math
{
    ////////////////////////
    // Immutable state
    ////////////////////////

    // reference to platform terms
    uint256 private TOKENS_PER_SHARE;
    // company representative address
    address private COMPANY_LEGAL_REPRESENTATIVE;
    // sets nominal value of a share
    uint256 public SHARE_NOMINAL_VALUE_EUR_ULPS;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // nominee address
    address private _nominee;
    // company management contract
    IEquityTokenController private _tokenController;

    ////////////////////////
    // Events
    ////////////////////////

    event LogTokensIssued(
        address indexed holder,
        address controller,
        uint256 amount
    );

    event LogTokensDestroyed(
        address indexed holder,
        address controller,
        uint256 amount
    );

    event LogChangeTokenController(
        address oldController,
        address newController,
        address by
    );

    event LogChangeNominee(
        address oldNominee,
        address newNominee,
        address controller,
        address by
    );

    ////////////////////////
    // Modifiers
    ////////////////////////

    modifier onlyIfIssueAllowed(address to, uint256 amount) {
        require(_tokenController.onGenerateTokens(msg.sender, to, amount), "NF_EQTOKEN_NO_GENERATE");
        _;
    }

    modifier onlyIfDestroyAllowed(address owner, uint256 amount) {
        require(_tokenController.onDestroyTokens(msg.sender, owner, amount), "NF_EQTOKEN_NO_DESTROY");
        _;
    }

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        IEquityTokenController controller,
        ETOTerms etoTerms,
        address nominee,
        address companyLegalRep
    )
        Agreement(universe.accessPolicy(), universe.forkArbiter())
        StandardSnapshotToken(
            IClonedTokenParent(0x0),
            0
        )
        TokenMetadata(
            etoTerms.EQUITY_TOKEN_NAME(),
            etoTerms.TOKEN_TERMS().EQUITY_TOKENS_PRECISION(),
            etoTerms.EQUITY_TOKEN_SYMBOL(),
            "1.0"
        )
        Daily(0)
        public
    {
        TOKENS_PER_SHARE = etoTerms.TOKEN_TERMS().EQUITY_TOKENS_PER_SHARE();
        COMPANY_LEGAL_REPRESENTATIVE = companyLegalRep;
        SHARE_NOMINAL_VALUE_EUR_ULPS = etoTerms.SHARE_NOMINAL_VALUE_EUR_ULPS();

        _nominee = nominee;
        _tokenController = controller;
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    //
    // Implements IEquityToken
    //

    /// @dev token controller performs access control
    function issueTokens(uint256 amount)
        public
        onlyIfIssueAllowed(address(this), amount)
        acceptAgreement(msg.sender)
    {
        mGenerateTokens(msg.sender, amount);
        emit LogTokensIssued(msg.sender, _tokenController, amount);
    }

    /// differs from transfer only by 'to' accepting agreement
    function distributeTokens(address to, uint256 amount)
        public
        acceptAgreement(to)
    {
        mTransfer(msg.sender, to, amount);
    }

    /// @dev token controller will allow if ETO in refund state
    function destroyTokens(uint256 amount)
        public
        onlyIfDestroyAllowed(msg.sender, amount)
        acceptAgreement(msg.sender)
    {
        mDestroyTokens(msg.sender, amount);
        emit LogTokensDestroyed(msg.sender, _tokenController, amount);
    }

    function changeNominee(address newNominee)
        public
    {
        // typically requires a valid migration in the old controller
        require(_tokenController.onChangeNominee(msg.sender, _nominee, newNominee));
        _nominee = newNominee;
        emit LogChangeNominee(_nominee, newNominee, _tokenController, msg.sender);
    }

    function tokensPerShare() public constant returns (uint256) {
        return TOKENS_PER_SHARE;
    }

    function sharesTotalSupply() public constant returns (uint256) {
        return tokensToShares(totalSupply());
    }

    function shareNominalValueEurUlps() public constant returns (uint256) {
        return SHARE_NOMINAL_VALUE_EUR_ULPS;
    }

    function nominee() public constant returns (address) {
        return _nominee;
    }

    function companyLegalRepresentative() public constant returns (address) {
        return COMPANY_LEGAL_REPRESENTATIVE;
    }

    //
    // Implements ITokenControllerHook
    //

    function changeTokenController(address newController)
        public
    {
        // typically requires a valid migration in the old controller
        require(_tokenController.onChangeTokenController(msg.sender, newController), "NF_ET_NO_PERM_NEW_CONTROLLER");
        _tokenController = IEquityTokenController(newController);
        emit LogChangeTokenController(_tokenController, newController, msg.sender);
    }

    function tokenController() public constant returns (address) {
        return _tokenController;
    }

    //
    // Implements IERC223Token with IERC223Callback (tokenFallback) callback
    //

    function transfer(address to, uint256 amount, bytes data)
        public
        returns (bool)
    {
        // it is necessary to point out implementation to be called
        BasicSnapshotToken.mTransfer(msg.sender, to, amount);

        // Notify the receiving contract.
        if (isContract(to)) {
            IERC223Callback(to).tokenFallback(msg.sender, amount, data);
        }
        return true;
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x45a709aff6d5ae42cb70f87551d8d7dbec5235cf2baa71a009ed0a9795258d8f, 0);
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    //
    // Implements MTokenController
    //

    function mOnTransfer(
        address from,
        address to,
        uint256 amount
    )
        internal
        acceptAgreement(from)
        returns (bool allow)
    {
        // if token controller allows transfer
        return _tokenController.onTransfer(msg.sender, from, to, amount);
    }

    function mOnApprove(
        address owner,
        address spender,
        uint256 amount
    )
        internal
        acceptAgreement(owner)
        returns (bool allow)
    {
        return _tokenController.onApprove(owner, spender, amount);
    }

    function mAllowanceOverride(
        address owner,
        address spender
    )
        internal
        constant
        returns (uint256)
    {
        return _tokenController.onAllowance(owner, spender);
    }

    //
    // Overrides Agreement
    //

    function mCanAmend(address legalRepresentative)
        internal
        returns (bool)
    {
        return legalRepresentative == _nominee;
    }

    function tokensToShares(uint256 amount)
        internal
        constant
        returns (uint256)
    {
        return divRound(amount, TOKENS_PER_SHARE);
    }
}
