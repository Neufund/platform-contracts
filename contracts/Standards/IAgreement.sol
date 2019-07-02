pragma solidity 0.4.26;

import "./IEthereumForkArbiter.sol";


/**
 * @title legally binding smart contract
 * @dev General approach to paring legal and smart contracts:
 * 1. All terms and agreement are between two parties: here between smart conctract legal representation and platform investor.
 * 2. Parties are represented by public Ethereum addresses. Platform investor is and address that holds and controls funds and receives and controls Neumark token
 * 3. Legal agreement has immutable part that corresponds to smart contract code and mutable part that may change for example due to changing regulations or other externalities that smart contract does not control.
 * 4. There should be a provision in legal document that future changes in mutable part cannot change terms of immutable part.
 * 5. Immutable part links to corresponding smart contract via its address.
 * 6. Additional provision should be added if smart contract supports it
 *  a. Fork provision
 *  b. Bugfixing provision (unilateral code update mechanism)
 *  c. Migration provision (bilateral code update mechanism)
 *
 * Details on Agreement base class:
 * 1. We bind smart contract to legal contract by storing uri (preferably ipfs or hash) of the legal contract in the smart contract. It is however crucial that such binding is done by smart contract legal representation so transaction establishing the link must be signed by respective wallet ('amendAgreement')
 * 2. Mutable part of agreement may change. We should be able to amend the uri later. Previous amendments should not be lost and should be retrievable (`amendAgreement` and 'pastAgreement' functions).
 * 3. It is up to deriving contract to decide where to put 'acceptAgreement' modifier. However situation where there is no cryptographic proof that given address was really acting in the transaction should be avoided, simplest example being 'to' address in `transfer` function of ERC20.
 *
**/
contract IAgreement {

    ////////////////////////
    // Events
    ////////////////////////

    event LogAgreementAccepted(
        address indexed accepter
    );

    event LogAgreementAmended(
        address contractLegalRepresentative,
        string agreementUri
    );

    /// @dev should have access restrictions so only contractLegalRepresentative may call
    function amendAgreement(string agreementUri) public;

    /// returns information on last amendment of the agreement
    /// @dev MUST revert if no agreements were set
    function currentAgreement()
        public
        constant
        returns
        (
            address contractLegalRepresentative,
            uint256 signedBlockTimestamp,
            string agreementUri,
            uint256 index
        );

    /// returns information on amendment with index
    /// @dev MAY revert on non existing amendment, indexing starts from 0
    function pastAgreement(uint256 amendmentIndex)
        public
        constant
        returns
        (
            address contractLegalRepresentative,
            uint256 signedBlockTimestamp,
            string agreementUri,
            uint256 index
        );

    /// returns the number of block at wchich `signatory` signed agreement
    /// @dev MUST return 0 if not signed
    function agreementSignedAtBlock(address signatory)
        public
        constant
        returns (uint256 blockNo);

    /// returns number of amendments made by contractLegalRepresentative
    function amendmentsCount()
        public
        constant
        returns (uint256);
}
