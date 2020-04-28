pragma solidity 0.4.26;

import "../Universe.sol";
import "../PlatformTerms.sol";
import "../Standards/IFeeDisbursal.sol";
import "../Serialization.sol";
import "../Math.sol";
import "../Standards/IERC223Token.sol";
import "../Standards/IWithdrawableToken.sol";
import "../Standards/IFeeDisbursalController.sol";
import "../KnownContracts.sol";
import "../KnownInterfaces.sol";
import "../PaymentTokens/EtherToken.sol";
import "../PaymentTokens/EuroToken.sol";

/// @title granular fee disbursal contract
contract FeeDisbursal is
    KnownContracts,
    KnownInterfaces,
    IFeeDisbursal
{

    ////////////////////////
    // Immutable state
    ////////////////////////
    Universe private UNIVERSE;

    // must be cached - otherwise default func runs out of gas
    address private ICBM_ETHER_TOKEN;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // controller instance
    IFeeDisbursalController private _feeDisbursalController;
    // map disbursable token address to pro rata token adresses to a list of disbursal events of that token
    mapping (address => mapping(address => Disbursal[])) private _disbursals;
    // mapping to track what disbursals have already been paid out to which user
    // disbursable token address => pro rata token address => user address => next disbursal index to be claimed
    mapping (address => mapping(address => mapping(address => uint256))) _disbursalProgress;


    ////////////////////////
    // Constructor
    ////////////////////////
    constructor(Universe universe, IFeeDisbursalController controller)
        public
    {
        require(universe != address(0x0));
        (bytes32 controllerContractId, ) = controller.contractId();
        require(controllerContractId == FEE_DISBURSAL_CONTROLLER);
        UNIVERSE = universe;
        ICBM_ETHER_TOKEN = universe.getSingleton(KNOWN_INTERFACE_ICBM_ETHER_TOKEN);
        _feeDisbursalController = controller;
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice get the disbursal at a given index for a given token
    function getDisbursal(address token, address proRataToken, uint256 index)
        public
        constant
    returns (
        uint256 snapshotId,
        uint256 amount,
        uint256 recycleableAfterTimestamp,
        uint256 disburseTimestamp,
        address disburser
    )
    {
        Disbursal storage disbursal = _disbursals[token][proRataToken][index];
        snapshotId = disbursal.snapshotId;
        amount = disbursal.amount;
        recycleableAfterTimestamp = disbursal.recycleableAfterTimestamp;
        disburseTimestamp = disbursal.disbursalTimestamp;
        disburser = disbursal.disburser;
    }

    /// @notice get disbursals for current snapshot id of the proRataToken that cannot be claimed yet
    function getNonClaimableDisbursals(address token, address proRataToken)
        public
        constant
    returns (uint256[3][] memory disbursals)
    {
        uint256 len = _disbursals[token][proRataToken].length;
        if (len == 0) {
            return;
        }
        // count elements with current snapshot id
        uint256 snapshotId = ITokenSnapshots(proRataToken).currentSnapshotId();
        uint256 ii = len;
        while(_disbursals[token][proRataToken][ii-1].snapshotId == snapshotId && --ii > 0) {}
        disbursals = new uint256[3][](len-ii);
        for(uint256 jj = 0; jj < len - ii; jj += 1) {
            disbursals[jj][0] = snapshotId;
            disbursals[jj][1] = _disbursals[token][proRataToken][ii+jj].amount;
            disbursals[jj][2] = ii+jj;
        }
    }

    /// @notice get count of disbursals for given token
    function getDisbursalCount(address token, address proRataToken)
        public
        constant
        returns (uint256)
    {
        return _disbursals[token][proRataToken].length;
    }

    /// @notice accepts the token disbursal offer and claim offered tokens, to be called by an investor
    function accept(address token, ITokenSnapshots proRataToken, uint256 until)
        public
    {
        // only allow verified and active accounts to claim tokens
        require(_feeDisbursalController.onAccept(token, proRataToken, msg.sender), "NF_ACCEPT_REJECTED");
        (uint256 claimedAmount, , uint256 nextIndex) = claimPrivate(token, proRataToken, msg.sender, until);

        // do the actual token transfer
        if (claimedAmount > 0) {
            IERC223Token ierc223Token = IERC223Token(token);
            assert(ierc223Token.transfer(msg.sender, claimedAmount, ""));
        }
        // log
        emit LogDisbursalAccepted(msg.sender, token, proRataToken, claimedAmount, nextIndex);
    }

    /// @notice accepts disbursals of multiple tokens and receives them, to be called an investor
    function acceptMultipleByToken(address[] tokens, ITokenSnapshots proRataToken)
        public
    {
        uint256[2][] memory claimed = new uint256[2][](tokens.length);
        // first gather the funds
        uint256 i;
        for (i = 0; i < tokens.length; i += 1) {
            // only allow verified and active accounts to claim tokens
            require(_feeDisbursalController.onAccept(tokens[i], proRataToken, msg.sender), "NF_ACCEPT_REJECTED");
            (claimed[i][0], ,claimed[i][1]) = claimPrivate(tokens[i], proRataToken, msg.sender, UINT256_MAX);
        }
        // then perform actual transfers, after all state changes are done, to prevent re-entry
        for (i = 0; i < tokens.length; i += 1) {
            if (claimed[i][0] > 0) {
                // do the actual token transfer
                IERC223Token ierc223Token = IERC223Token(tokens[i]);
                assert(ierc223Token.transfer(msg.sender, claimed[i][0], ""));
            }
            // always log, even empty amounts
            emit LogDisbursalAccepted(msg.sender, tokens[i], proRataToken, claimed[i][0], claimed[i][1]);
        }
    }

    /// @notice accepts disbursals for single token against many pro rata tokens
    function acceptMultipleByProRataToken(address token, ITokenSnapshots[] proRataTokens)
        public
    {
        uint256 i;
        uint256 fullAmount;
        for (i = 0; i < proRataTokens.length; i += 1) {
            require(_feeDisbursalController.onAccept(token, proRataTokens[i], msg.sender), "NF_ACCEPT_REJECTED");
            (uint256 amount, , uint256 nextIndex) = claimPrivate(token, proRataTokens[i], msg.sender, UINT256_MAX);
            fullAmount += amount;
            // emit here, that's how we avoid second loop and storing particular claims
            emit LogDisbursalAccepted(msg.sender, token, proRataTokens[i], amount, nextIndex);
        }
        if (fullAmount > 0) {
            // and now why this method exits - one single transfer of token from many distributions
            IERC223Token ierc223Token = IERC223Token(token);
            assert(ierc223Token.transfer(msg.sender, fullAmount, ""));
        }
    }

    /// @notice rejects disbursal of token which leads to recycle and disbursal of rejected amount
    function reject(address token, ITokenSnapshots proRataToken, uint256 until)
        public
    {
        // only allow verified and active accounts to claim tokens
        require(_feeDisbursalController.onReject(token, address(0), msg.sender), "NF_REJECT_REJECTED");
        (uint256 claimedAmount, , uint256 nextIndex) = claimPrivate(token, proRataToken, msg.sender, until);
        // what was rejected will be recycled
        if (claimedAmount > 0) {
            PlatformTerms terms = PlatformTerms(UNIVERSE.platformTerms());
            disburse(token, this, claimedAmount, proRataToken, terms.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION());
        }
        // log
        emit LogDisbursalRejected(msg.sender, token, proRataToken, claimedAmount, nextIndex);
    }

    /// @notice check how many tokens of a certain kind can be claimed by an account
    function claimable(address token, ITokenSnapshots proRataToken, address claimer, uint256 until)
        public
        constant
    returns (uint256 claimableAmount, uint256 totalAmount, uint256 recycleableAfterTimestamp, uint256 firstIndex)
    {
        firstIndex = _disbursalProgress[token][proRataToken][claimer];
        if (firstIndex < _disbursals[token][proRataToken].length) {
            recycleableAfterTimestamp = _disbursals[token][proRataToken][firstIndex].recycleableAfterTimestamp;
        }
        // we don't do to a verified check here, this serves purely to check how much is claimable for an address
        (claimableAmount, totalAmount,) = claimablePrivate(token, proRataToken, claimer, until, false);
    }

    /// @notice check how much fund for each disbursable tokens can be claimed by claimer
    function claimableMutipleByToken(address[] tokens, ITokenSnapshots proRataToken, address claimer)
        public
        constant
    returns (uint256[4][] claimables)
    {
        claimables = new uint256[4][](tokens.length);
        for (uint256 i = 0; i < tokens.length; i += 1) {
            claimables[i][3] = _disbursalProgress[tokens[i]][proRataToken][claimer];
            if (claimables[i][3] < _disbursals[tokens[i]][proRataToken].length) {
                claimables[i][2] = _disbursals[tokens[i]][proRataToken][claimables[i][3]].recycleableAfterTimestamp;
            }
            (claimables[i][0], claimables[i][1], ) = claimablePrivate(tokens[i], proRataToken, claimer, UINT256_MAX, false);
        }
    }

    /// @notice check how many tokens can be claimed against many pro rata tokens
    function claimableMutipleByProRataToken(address token, ITokenSnapshots[] proRataTokens, address claimer)
        public
        constant
    returns (uint256[4][] claimables)
    {
        claimables = new uint256[4][](proRataTokens.length);
        for (uint256 i = 0; i < proRataTokens.length; i += 1) {
            claimables[i][3] = _disbursalProgress[token][proRataTokens[i]][claimer];
            if (claimables[i][3] < _disbursals[token][proRataTokens[i]].length) {
                claimables[i][2] = _disbursals[token][proRataTokens[i]][claimables[i][3]].recycleableAfterTimestamp;
            }
            (claimables[i][0], claimables[i][1], ) = claimablePrivate(token, proRataTokens[i], claimer, UINT256_MAX, false);
        }
    }

    /// @notice recycle a token for multiple investors
    function recycle(address token, ITokenSnapshots proRataToken, address[] investors, uint256 until)
        public
    {
        require(_feeDisbursalController.onRecycle(token, proRataToken, investors, until), "");
        // cycle through all investors collect the claimable and recycleable funds
        // also move the _disbursalProgress pointer
        uint256 totalClaimableAmount = 0;
        for (uint256 i = 0; i < investors.length; i += 1) {
            (uint256 claimableAmount, ,uint256 nextIndex) = claimablePrivate(token, ITokenSnapshots(proRataToken), investors[i], until, true);
            totalClaimableAmount += claimableAmount;
            _disbursalProgress[token][proRataToken][investors[i]] = nextIndex;
        }

        // skip disbursal if amount == 0
        if (totalClaimableAmount > 0) {
            // now re-disburse, we're now the disburser
            PlatformTerms terms = PlatformTerms(UNIVERSE.platformTerms());
            disburse(token, this, totalClaimableAmount, proRataToken, terms.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION());
        }

        // log
        emit LogFundsRecycled(proRataToken, token, totalClaimableAmount, msg.sender);
    }

    /// @notice check how much we can recycle for multiple investors
    function recycleable(address token, ITokenSnapshots proRataToken, address[] investors, uint256 until)
        public
        constant
    returns (uint256)
    {
        // cycle through all investors collect the claimable and recycleable funds
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < investors.length; i += 1) {
            (uint256 claimableAmount,,) = claimablePrivate(token, proRataToken, investors[i], until, true);
            totalAmount += claimableAmount;
        }
        return totalAmount;
    }

    /// @notice get current controller
    function feeDisbursalController()
        public
        constant
        returns (IFeeDisbursalController)
    {
        return _feeDisbursalController;
    }

    /// @notice update current controller
    function changeFeeDisbursalController(IFeeDisbursalController newController)
        public
    {
        require(_feeDisbursalController.onChangeFeeDisbursalController(msg.sender, newController), "NF_CHANGING_CONTROLLER_REJECTED");
        address oldController = address(_feeDisbursalController);
        _feeDisbursalController = newController;
        emit LogChangeFeeDisbursalController(oldController, address(newController), msg.sender);
    }

    /// @notice implementation of tokenfallback, calls the internal disburse function
    /// legacy onTokenTransfer is also supported via imported file
    function tokenFallback(address wallet, uint256 amount, bytes data)
        public
    {
        tokenFallbackPrivate(msg.sender, wallet, amount, data);
    }

    /// @notice legacy callback used by ICBMLockedAccount: approve and call pattern
    function receiveApproval(address from, uint256 amount, address tokenAddress, bytes data)
        public
        returns (bool success)
    {
        // sender must be token
        require(msg.sender == tokenAddress);
        // transfer assets
        IERC20Token token = IERC20Token(tokenAddress);
        // this needs a special permission in case of ICBM Euro Token
        require(token.transferFrom(from, address(this), amount));

        // now in case we convert from icbm token
        // migrate previous asset token depends on token type, unfortunatelly deposit function differs so we have to cast. this is weak...
        if (tokenAddress == ICBM_ETHER_TOKEN) {
            // after EtherToken withdraw, deposit ether into new token
            IWithdrawableToken(tokenAddress).withdraw(amount);
            token = IERC20Token(UNIVERSE.etherToken());
            EtherToken(token).deposit.value(amount)();
        }
        if(tokenAddress == UNIVERSE.getSingleton(KNOWN_INTERFACE_ICBM_EURO_TOKEN)) {
            IWithdrawableToken(tokenAddress).withdraw(amount);
            token = IERC20Token(UNIVERSE.euroToken());
            // this requires EuroToken DEPOSIT_MANAGER role
            EuroToken(token).deposit(this, amount, 0x0);
        }
        tokenFallbackPrivate(address(token), from, amount, data);
        return true;
    }

    //
    // IContractId Implementation
    //

    function contractId()
        public
        pure
        returns (bytes32 id, uint256 version)
    {
        return (0x2e1a7e4ac88445368dddb31fe43d29638868837724e9be8ffd156f21a971a4d7, 0);
    }

    //
    // Payable default function to receive ether during migration
    //
    function ()
        public
        payable
    {
        require(msg.sender == ICBM_ETHER_TOKEN);
    }


    ////////////////////////
    // Private functions
    ////////////////////////

    function tokenFallbackPrivate(address token, address wallet, uint256 amount, bytes data)
        private
    {
        ITokenSnapshots proRataToken;
        PlatformTerms terms = PlatformTerms(UNIVERSE.platformTerms());
        uint256 recycleAfterDuration = terms.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION();
        if (data.length == 20) {
            proRataToken = ITokenSnapshots(Serialization.decodeAddress(data));
        }
        else if (data.length == 52) {
            address proRataTokenAddress;
            (proRataTokenAddress, recycleAfterDuration) = Serialization.decodeAddressUInt256(data);
            proRataToken = ITokenSnapshots(proRataTokenAddress);
        } else {
            // legacy ICBMLockedAccount compat mode which does not send pro rata token address and we assume NEU
            proRataToken = UNIVERSE.neumark();
        }
        disburse(token, wallet, amount, proRataToken, recycleAfterDuration);
    }

    /// @notice create a new disbursal
    /// @param token address of the token to disburse
    /// @param disburser address of the actor disbursing (e.g. eto commitment)
    /// @param amount amount of the disbursable tokens
    /// @param proRataToken address of the token that defines the pro rata
    function disburse(address token, address disburser, uint256 amount, ITokenSnapshots proRataToken, uint256 recycleAfterDuration)
        private
    {
        require(
            _feeDisbursalController.onDisburse(token, disburser, amount, address(proRataToken), recycleAfterDuration), "NF_DISBURSAL_REJECTED");

        uint256 snapshotId = proRataToken.currentSnapshotId();
        uint256 proRataTokenTotalSupply = proRataToken.totalSupplyAt(snapshotId);
        // if token disburses itself we cannot disburse full total supply
        if (token == address(proRataToken)) {
            proRataTokenTotalSupply -= proRataToken.balanceOfAt(address(this), snapshotId);
        }
        require(proRataTokenTotalSupply > 0, "NF_NO_DISBURSE_EMPTY_TOKEN");
        uint256 recycleAfter = Math.add(block.timestamp, recycleAfterDuration);
        assert(recycleAfter<2**128);

        Disbursal[] storage disbursals = _disbursals[token][proRataToken];
        // try to merge with an existing disbursal
        bool merged = false;
        for ( uint256 i = disbursals.length - 1; i != UINT256_MAX; i-- ) {
            // we can only merge if we have the same snapshot id
            // we can break here, as continuing down the loop the snapshot ids will decrease
            Disbursal storage disbursal = disbursals[i];
            if ( disbursal.snapshotId < snapshotId) {
                break;
            }
            // the existing disbursal must be the same on number of params so we can merge
            // disbursal.snapshotId is guaranteed to == proRataToken.currentSnapshotId()
            if ( disbursal.disburser == disburser ) {
                merged = true;
                disbursal.amount += amount;
                disbursal.recycleableAfterTimestamp = uint128(recycleAfter);
                disbursal.disbursalTimestamp = uint128(block.timestamp);
                break;
            }
        }

        // create a new disbursal entry
        if (!merged) {
            disbursals.push(Disbursal({
                recycleableAfterTimestamp: uint128(recycleAfter),
                disbursalTimestamp: uint128(block.timestamp),
                amount: amount,
                snapshotId: snapshotId,
                disburser: disburser
            }));
        }
        emit LogDisbursalCreated(proRataToken, token, amount, recycleAfterDuration, disburser, merged ? i : disbursals.length - 1);
    }


    /// @notice claim a token for an claimer, returns the amount of tokens claimed
    /// @param token address of the disbursable token
    /// @param claimer address of the claimer that will receive the funds
    /// @param until until what index to claim to
    function claimPrivate(address token, ITokenSnapshots proRataToken, address claimer, uint256 until)
        private
    returns (uint256 claimedAmount, uint256 totalAmount, uint256 nextIndex)
    {
        (claimedAmount, totalAmount, nextIndex) = claimablePrivate(token, proRataToken, claimer, until, false);

        // mark claimer disbursal progress
        _disbursalProgress[token][proRataToken][claimer] = nextIndex;
    }

    /// @notice get the amount of tokens that can be claimed by a given claimer
    /// @param token address of the disbursable token
    /// @param claimer address of the claimer that will receive the funds
    /// @param until until what index to claim to, use UINT256_MAX for all
    /// @param onlyRecycleable show only disbursable funds that can be recycled
    /// @return a tuple of (amount claimed, total amount disbursed, next disbursal index to be claimed)
    function claimablePrivate(address token, ITokenSnapshots proRataToken, address claimer, uint256 until, bool onlyRecycleable)
        private
        constant
        returns (uint256 claimableAmount, uint256 totalAmount, uint256 nextIndex)
    {
        nextIndex = Math.min(until, _disbursals[token][proRataToken].length);
        uint256 currentIndex = _disbursalProgress[token][proRataToken][claimer];
        uint256 currentSnapshotId = proRataToken.currentSnapshotId();
        for (; currentIndex < nextIndex; currentIndex += 1) {
            Disbursal storage disbursal = _disbursals[token][proRataToken][currentIndex];
            uint256 snapshotId = disbursal.snapshotId;
            // do not pay out claims from the current snapshot
            if ( snapshotId == currentSnapshotId )
                break;
            // in case of just determining the recyclable amount of tokens, break when we
            // cross this time, this also assumes disbursal.recycleableAfterTimestamp in each disbursal is the same or increases
            // in case it decreases, recycle will not be possible until 'blocking' disbursal also expires
            if ( onlyRecycleable && disbursal.recycleableAfterTimestamp > block.timestamp )
                break;
            // add to total amount
            totalAmount += disbursal.amount;
            // add claimable amount
            claimableAmount += calculateClaimableAmount(claimer, disbursal.amount, token, proRataToken, snapshotId);
        }
        return (claimableAmount, totalAmount, currentIndex);
    }

    function calculateClaimableAmount(address claimer, uint256 disbursalAmount, address token, ITokenSnapshots proRataToken, uint256 snapshotId)
        private
        constant
        returns (uint256)
    {
        uint256 proRataClaimerBalance = proRataToken.balanceOfAt(claimer, snapshotId);
        // if no balance then continue
        if (proRataClaimerBalance == 0) {
            return 0;
        }
        // compute pro rata amount
        uint256 proRataTokenTotalSupply = proRataToken.totalSupplyAt(snapshotId);
        // if we disburse token that is pro rata token (downround) then remove what fee disbursal holds from total supply
        if (token == address(proRataToken)) {
            proRataTokenTotalSupply -= proRataToken.balanceOfAt(address(this), snapshotId);
        }
        // using round HALF_UP we risks rounding errors to accumulate and overflow balance at the last claimer
        // example: disbursalAmount = 3, total supply = 2 and two claimers with 1 pro rata token balance
        // with HALF_UP first claims 2 and seconds claims2 but balance is 1 at that point
        // thus we round down here saving tons of gas by not doing additional bookkeeping
        // consequence: small amounts of disbursed funds will be left in the contract
        return Math.mul(disbursalAmount, proRataClaimerBalance) / proRataTokenTotalSupply;
    }
}
