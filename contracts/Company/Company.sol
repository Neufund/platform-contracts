pragma solidity 0.4.23;

import "./ICompanyManagement.sol";
import "../Agreement.sol";


contract ShareholderResolution {
    // state machine like ETO
    // Setup -> Voting -> Signing -> Protest -> (Yes/No/Protested)
    // executes methods on Company on Yes if outcome defined
}


contract Company is
    Agreement,
    ICompanyManagement
{
    // is every EquityToken controller!
    // uint256 totalShares;
    // ShareholderRigths SHAREHOLDER_RIGHTS
    // amendAgreement(new links, new ShareholderRigths) onlyResolution
    // EquityToken[] - list of emitted equity tokens
    // ETO[] - list of ETOs that generated tokens
    // register_resolution(type, bytes payload) onlyCompanyRep onlyNominee
    // pay_dividend(amount) onlyCompanyRep
    // enableTrading(token, bool) onlyResolution
    // increaseShares(amount) onlyResolution
    // decreaseShares(amount) onlyResolution
    // downround(token, amount) onlyNominee -> to distribute downround shares to investors of particular token
    // damages(token, amount) onlyNominee -> to distribure damages (tokens or money)
    // exit(amount, timeout) onlyResolution
    // tag(amount, timeout) onlyResolution
    // eto(ETOCommitment, EquityToken) -> when passed, registers new token and new ETO as pending
    // register_token(ETOCommitment, EquityToken) onlyETO -> on successful ETO, ETO will call Company contract to add itself, calls amendAgreement
    // first_eto(ETOCommitment, EquityToken) onlyCompany
    // register_report(ipfs_hash) -> information rights
    // issueTokens onlyETO
}
