pragma solidity 0.4.25;

import "../Universe.sol";
import "../AccessControl/AccessControlled.sol";
import "../Reclaimable.sol";
import "../Standards/IFeeDisbursal.sol";
import "../Identity/IIdentityRegistry.sol";
import "../SnapshotToken/BasicSnapshotToken.sol";
import "../Serialization.sol";
import "../Math.sol";
import "../Standards/IERC223Token.sol";


contract FeeDisbursal is
    AccessControlled,
    Reclaimable,
    IFeeDisbursal,
    IdentityRecord,
    Serialization,
    Math
{

    uint256 constant UINT256_MAX = 2**256 - 1;


    ////////////////////////
    // Types
    ////////////////////////
    struct Disbursal {
        // snapshop ID of the pro-rata token, which will define which amounts to disburse against
        uint256 snapshotId;
        // amount of tokens to disburse
        uint256 amount;
        // address of the token used to determine the user pro rata amount, must be a snapshottoken, default is NEU
        BasicSnapshotToken proRataToken;
        // time after which claims to this token can be recycled
        uint256 recycleAfterTimestamp;
        // contract sending the disbursal
        address disburser;
    }

    ////////////////////////
    // Immutable state
    ////////////////////////
    Universe private UNIVERSE;
    IIdentityRegistry private IDENTITY_REGISTRY;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // map token addresses to a list of disbursal events of that token
    mapping (address => Disbursal[]) private _disbursals;
    // mapping to track what disbursals have already been paid out to which user
    // token address => user address => disbursal progress
    mapping (address => mapping(address => uint256)) _disbursalProgress;


    ////////////////////////
    // Constructor
    ////////////////////////
    constructor(Universe universe)
        AccessControlled(universe.accessPolicy())
        Reclaimable()
        public
    {
        UNIVERSE = universe;
        IDENTITY_REGISTRY = IIdentityRegistry(universe.identityRegistry());
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice get the disbursal at a given index for a given token
    /// @param token address of the claimable token
    /// @param index until what index to claim to
    function getDisbursal(address token, uint256 index)
    public
    view
    returns (
        uint256 snapshotId,
        uint256 amount,
        BasicSnapshotToken proRataToken,
        uint256 recycleAfterTimestamp,
        address disburser
    )
    {
        Disbursal storage disbursal = _disbursals[token][index];
        snapshotId = disbursal.snapshotId;
        amount = disbursal.amount;
        proRataToken = disbursal.proRataToken;
        recycleAfterTimestamp = disbursal.recycleAfterTimestamp;
        disburser = disbursal.disburser;
    }

    /// @notice claim a token, to be called an investor
    /// @param token address of the claimable token
    /// @param until until what index to claim to
    function claim(address token, uint256 until)
    public
    returns (uint256 claimableAmount, uint256 lastIndex)
    {
        // only allow verified and active accounts to claim tokens
        // @TODO: move access control to Controller
        IdentityClaims memory claims = deserializeClaims(IDENTITY_REGISTRY.getClaims(msg.sender));
        require(claims.isVerified && !claims.accountFrozen, "NF_DISB_NOT_VER");
        return claimPrivate(token, msg.sender, until);
    }

    /// @notice claim multiple tokens, to be called an investor
    /// @param tokens addresses of the claimable token
    function claimMultiple(address[] tokens)
    public
    {
        // only allow verified and active accounts to claim tokens
        // @TODO: move access control to Controller
        IdentityClaims memory claims = deserializeClaims(IDENTITY_REGISTRY.getClaims(msg.sender));
        require(claims.isVerified && !claims.accountFrozen, "NF_DISB_NOT_VER");
        for (uint256 i = 0; i < tokens.length; i += 1) {
            claimPrivate(tokens[i], msg.sender, UINT256_MAX);
        }
    }

    /// @notice check how many tokens of a certain kind can be claimed by an account
    /// @param token address of the claimable token
    /// @param spender address of the spender that would receive the funds
    /// @param until until what index to claim to
    function claimable(address token, address spender, uint256 until)
    public
    view
    returns (uint256 claimableAmount, uint256 lastIndex)
    {   
        // we don't do to a verified check here, this serves purely to check how much is claimable for an address
        return claimablePrivate(token, spender, until);
    }

    /// @notice claim a token, to be called an investor
    /// @param tokens addresses of the claimable token
    /// @param spender address of the spender that would receive the funds
    function claimableMutiple(address[] tokens, address spender)
    public
    view
    returns (uint256[])
    {   
        // we don't to do a verified check here, this serves purely to check how much is claimable for an address
        uint256[] memory result = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i += 1) {
            (uint256 claimableAmount, uint256 lastIndex) = claimablePrivate(tokens[i], spender, UINT256_MAX);
            result[i] = claimableAmount;
        }
        return result;
    }

    /// @notice claim a token, to be called an investor
    /// @param token address of the recyclable token
    /// @param investors list of investors we want to recycle tokens for
    /// @param until until what index to claim to
    function recycle(address token, address[] investors, uint256 until)
    public
    {        
        // @TODO: Recycle funds
        // @TODO: add log message
    }

    // implementation of tokenfallback
    function tokenFallback(address wallet, uint256 amount, bytes data)
        public
        only(ROLE_DISBURSER)
    {
        // @TODO: move access control to Controller
        require(isDisbursableToken(msg.sender), "NF_DISB_UKNOWN_TOKEN");
        require(amount > 0, "NF_DISB_ZERO_AMOUNT");

        // cast and check pro rata token
        BasicSnapshotToken proRataToken = BasicSnapshotToken(decodeAddress(data));
        uint256 snapshotId = proRataToken.currentSnapshotId() - 1;
        require(proRataToken.totalSupplyAt(snapshotId) > 0, "");

        // create a new disbursal entry
        _disbursals[msg.sender].push(Disbursal({
            recycleAfterTimestamp: block.timestamp,
            amount: amount,
            proRataToken: proRataToken,
            snapshotId: snapshotId,
            disburser: wallet
        }));
        //@TODO: add log message
    }

    // implementation of reclaimbale
    function reclaim(IBasicToken token)
        public
        only(ROLE_RECLAIMER)
    {   
        // forbid reclaiming any or our platform payment tokens
        // @TODO: move access control to Controller
        require(!isDisbursableToken(address(token)));
        Reclaimable.reclaim(token);
    }

    /// @notice helper to determine if the token at the given address is supported for disbursing
    /// @param token address of token in question
    function isDisbursableToken(address token)
        public
        view
        returns (bool)
    {   
        // @TODO: migrate this to new, more flexible token registering in universe
        if (token == address(UNIVERSE.etherToken())) return true;
        if (token == address(UNIVERSE.euroToken())) return true;
        return false;
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    /// @notice claim a token for an spender, returns the amount of tokens claimed
    /// @param token address of the claimable token
    /// @param spender address of the spender that will receive the funds
    /// @param until until what index to claim to
    function claimPrivate(address token, address spender, uint256 until)
    public
    returns (uint256 claimedAmount, uint256 lastIndex)
    {
        require(isDisbursableToken(token), "NF_DISB_UKNOWN_TOKEN");
        (claimedAmount, lastIndex) = claimablePrivate(token, spender, until);

        // mark spender disbursal progress
        _disbursalProgress[token][spender] = lastIndex;

        // do the actual token transfer
        IERC223Token ierc223Token = IERC223Token(token);
        ierc223Token.transfer(spender, claimedAmount, "");
        //@TODO: add log message
    }

    /// @notice get the amount of tokens that can be claimed by a given spender
    /// @param token address of the claimable token
    /// @param spender address of the spender that will receive the funds
    /// @param until until what index to claim to, use UINT256_MAX for all
    function claimablePrivate(address token, address spender, uint256 until)
    public
    view
    returns (uint256 claimableAmount, uint256 lastIndex)
    {
        require(isDisbursableToken(token), "NF_DISB_UKNOWN_TOKEN");
        lastIndex = min(until, _disbursals[token].length);
        claimableAmount = 0;
        for (uint256 i = _disbursalProgress[token][spender]; i < lastIndex; i += 1) {
            Disbursal storage disbursal = _disbursals[token][i];
            BasicSnapshotToken proRataToken = BasicSnapshotToken(disbursal.proRataToken);
            uint256 snapshotId = disbursal.snapshotId;
            uint256 proRataTotalSupply = proRataToken.totalSupplyAt(snapshotId);
            uint256 proRataSpenderBalance = proRataToken.balanceOfAt(spender, snapshotId);
            if (proRataTotalSupply == 0) continue;
            // @TODO: do we need checks for overflow here? probably not as uint256 is really large..
            // this should round down, so we should not be spending more than we have in our balance
            claimableAmount += (proRataSpenderBalance * disbursal.amount) / proRataTotalSupply;
        }
        return (claimableAmount, lastIndex);
    }

}