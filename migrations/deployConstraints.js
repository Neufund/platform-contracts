import { toChecksumAddress } from "web3-utils";

import createAccessPolicy from "../test/helpers/createAccessPolicy";
import { TriState } from "../test/helpers/triState";
import roles from "../test/helpers/roles";
import { stringify } from "../test/helpers/constants";
import { knownInterfaces } from "../test/helpers/knownInterfaces";
import { constraints } from "./config";
import { deployedAddresses, describedConstraints } from "./configETOTermsFixtures";

export async function deployConstraints(
  config,
  artifacts,
  deployer,
  deployerAddress,
  universe,
  step,
) {
  const RoleBasedAccessPolicy = artifacts.require(config.artifacts.ROLE_BASED_ACCESS_POLICY);
  const ETOTermsConstraints = artifacts.require(config.artifacts.ETO_TERMS_CONSTRAINTS);

  console.log("Temporary permission to change universe");
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  await createAccessPolicy(accessPolicy, [
    // temporary access to universe, will be dropped in finalize
    {
      subject: deployerAddress,
      role: roles.universeManager,
      object: universe.address,
      state: TriState.Allow,
    },
  ]);

  const newlyDeployedConstraints = [];

  // deploy only 1 pack of products
  for (const constraint of constraints.filter(c => c._deploymentMetadata.step === step)) {
    console.log(`Deploying EtoTermsConstraints: ${constraint.NAME}`);
    const updatedConstraint = Object.assign(constraint, {
      TOKEN_OFFERING_OPERATOR: config.addresses[constraint.TOKEN_OFFERING_OPERATOR],
    });
    await deployer.deploy(
      ETOTermsConstraints,
      updatedConstraint.CAN_SET_TRANSFERABILITY,
      updatedConstraint.HAS_NOMINEE,
      updatedConstraint.MIN_TICKET_SIZE_EUR_ULPS,
      updatedConstraint.MAX_TICKET_SIZE_EUR_ULPS,
      updatedConstraint.MIN_INVESTMENT_AMOUNT_EUR_ULPS,
      updatedConstraint.MAX_INVESTMENT_AMOUNT_EUR_ULPS,
      updatedConstraint.NAME,
      updatedConstraint.OFFERING_DOCUMENT_TYPE,
      updatedConstraint.OFFERING_DOCUMENT_SUB_TYPE,
      updatedConstraint.JURISDICTION,
      updatedConstraint.ASSET_TYPE,
      updatedConstraint.TOKEN_OFFERING_OPERATOR,
    );
    const etoTermsConstraints = await ETOTermsConstraints.deployed();
    // save address
    const constraintAddress = toChecksumAddress(etoTermsConstraints.address);
    deployedAddresses[constraint.NAME] = constraintAddress;
    newlyDeployedConstraints.push(constraintAddress);

    describedConstraints[constraintAddress] = stringify(updatedConstraint);
  }
  console.log("Adding to terms constraints collection in universe");
  const setCount = newlyDeployedConstraints.length;
  await universe.setCollectionsInterfaces(
    Array(setCount).fill(knownInterfaces.etoTermsConstraints),
    newlyDeployedConstraints,
    Array(setCount).fill(true),
  );
  // not available products should be switched off on production networks
  if (config.isLiveDeployment) {
    console.log("... and immediately removing because constraints no longer active");
    const unavailableAddresses = newlyDeployedConstraints.filter(
      a => !describedConstraints[a]._deploymentMetadata.available,
    );
    console.log(unavailableAddresses);
    const resetCount = unavailableAddresses.length;
    if (resetCount > 0) {
      await universe.setCollectionsInterfaces(
        Array(resetCount).fill(knownInterfaces.etoTermsConstraints),
        unavailableAddresses,
        Array(resetCount).fill(false),
      );
    }
  }
}
