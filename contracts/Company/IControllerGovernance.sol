pragma solidity 0.4.26;

import "./Gov.sol";
import "./IControllerGovernanceEngine.sol";
import "./IControllerGeneralInformation.sol";
import "./IControllerGovernanceToken.sol";
import "./IControllerETO.sol";
import "./IEquityTokenController.sol";
import "./IControllerDividends.sol";
import "../Standards/IAgreement.sol";
import "../Standards/IContractId.sol";


/// @title a reference interface that groups all possible governance module interfaces
contract IControllerGovernance is
    IAgreement,
    IEquityTokenController,
    IControllerGovernanceEngine,
    IControllerGeneralInformation,
    IControllerGovernanceToken,
    IControllerETO,
    IControllerDividends,
    IContractId
{
    // this will close company (transition to terminal state) and close all associated tokens
    // requires decision to be made before according to implemented governance
    // also requires that certain obligations are met like proceeds were distributed
    // so anyone should be able to call this function
    // function closeCompany() public;

    // this will cancel closing of the company due to obligations not met in time
    // being able to cancel closing should not depend on who is calling the function.
    // function cancelCompanyClosing() public;

    // list of governance modules in controller, same scheme as IContractId
    /// @dev includes contractId as last one
    // function moduleId() public pure returns (bytes32[6] ids, uint256[6] versions);
}
