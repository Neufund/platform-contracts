const moment = require("moment");
const deployableArtifacts = require("../test/helpers/artifacts").artifacts;
const path = require("path");
const networks = require("../truffle.js").networks;

export { constraints } from "./configETOTermsFixtures";

export function getDeployerAccount(network, accounts) {
  const netDefinitions = networks[network];
  return netDefinitions.from || accounts[0];
}

export function getNetworkDefinition(network) {
  return Object.assign({}, networks[network]);
}

export function getConfig(web3, network, accounts) {
  const Q18 = web3.toBigNumber("10").pow(18);

  let config;
  // icbmConfig kept for dev networks to recreate whole system
  const icbmConfig = {
    Q18,
    // ICBMLockedAccount
    LOCK_DURATION: 18 * 30 * 24 * 60 * 60,
    PENALTY_FRACTION: web3.toBigNumber("0.1").mul(Q18),
    // Commitment
    START_DATE: moment("2017-11-12T11:00:00.000Z").valueOf() / 1000,
    CAP_EUR: web3.toBigNumber("200000000").mul(Q18),
    MIN_TICKET_EUR: web3.toBigNumber("290").mul(Q18),
    ETH_EUR_FRACTION: web3.toBigNumber("290").mul(Q18),
    // Agreements
    RESERVATION_AGREEMENT: "ipfs:QmbH7mtyWpwTxigGtvnbYJAJ9ZZPe1FDxr9hTc2mNwpRe2", // attached to Commitment
    NEUMARK_HOLDER_AGREEMENT: "ipfs:QmVQfuibCipv9j6v4cSYTnvkjoBnx3DqSLNY3PKg8MZbP4", // attached to Neumark
    // Maps roles to addresses
    addresses: {
      ACCESS_CONTROLLER: "0x8AD8B24594ef90c15B2bd05edE0c67509c036B29",
      LOCKED_ACCOUNT_ADMIN: "0x94c32ab2c5d946aCA3aEbb543b46948d5ad0B622",
      WHITELIST_ADMIN: "0x7F5552B918a6FfC97c1705852029Fb40380aA399",
      PLATFORM_OPERATOR_WALLET: "0xA826813D0eb5D629E959c02b8f7a3d0f53066Ce4",
      PLATFORM_OPERATOR_REPRESENTATIVE: "0x83CBaB70Bc1d4e08997e5e00F2A3f1bCE225811F",
      EURT_DEPOSIT_MANAGER: "0x30A72cD2F5AEDCd86c7f199E0500235674a08E27",
    },
  };

  // platform config - new settings go here
  const platformConfig = {
    // euro token settings
    MIN_DEPOSIT_AMOUNT_EUR_ULPS: Q18.mul(1),
    MIN_WITHDRAW_AMOUNT_EUR_ULPS: Q18.mul(5),
    MAX_SIMPLE_EXCHANGE_ALLOWANCE_EUR_ULPS: Q18.mul(25),
    // euro token fees
    EURT_WITHDRAWAL_FEE_FRAC: Q18.mul(0.005),
    EURT_DEPOSIT_FEE_FRAC: Q18.mul(0),
    // Maps roles to addresses
    addresses: {
      EURT_DEPOSIT_MANAGER: "0xB9B0c83590A442bc8D01a9823E6df66762B64755",
      UNIVERSE_MANAGER: "0x45eF682bC0467edE800547Ce3866E0A14e93cB45",
      IDENTITY_MANAGER: "0xf026dfC7de31d153Ae6B0375b93BA4E138de9130",
      EURT_LEGAL_MANAGER: "0x5c31F869F4f9891ca3470bE30Ca3d9e60ced0a05",
      GAS_EXCHANGE: "0x58125e023252A1Da9655994fC446892dbD1B2C03",
      TOKEN_RATE_ORACLE: "0x7C725f972D1ebDEF5Bbfd8996d3Cbe307b23cd42",
      GAS_STIPEND_SERVICE: "0xABa4430574f2353C0A22Ca4CF2d4a122f0031245",
    },
    // set it to Commitment contract address to continue deployment over it
    ICBM_COMMITMENT_ADDRESS: null,
    // set it to deployed Universe to continue deployment over it
    UNIVERSE_ADDRESS: null,
    // set to true to deploy separate access policy for Universe
    ISOLATED_UNIVERSE: false,
    // deployed artifacts (may be mocked in overrides)
    artifacts: deployableArtifacts,
    shouldSkipDeployment: network.endsWith("_test") || network === "coverage",
    isLiveDeployment: network.endsWith("live"),
    shouldSkipStep: filename => {
      if (config.shouldSkipDeployment) return true;
      const stepNumber = parseInt(path.basename(filename), 10);
      console.log(`checking step ${stepNumber}`);
      return !!(config.ICBM_COMMITMENT_ADDRESS && stepNumber < 7);
    },
  };
  // override icbmConfig with platform config and from the truffle.js
  const networkDefinition = getNetworkDefinition(network);
  config = Object.assign(
    {},
    icbmConfig,
    platformConfig,
    networkDefinition.deploymentConfigOverride,
  );
  config.addresses = Object.assign({}, icbmConfig.addresses, platformConfig.addresses);
  config.artifacts = Object.assign({}, icbmConfig.artifacts, platformConfig.artifacts);

  // assign addresses to roles according to network type
  const roleMapping = config.addresses;
  const DEPLOYER = getDeployerAccount(network, accounts);
  if (!config.isLiveDeployment) {
    // on all test network, map all roles to deployer
    for (const role of Object.keys(roleMapping)) {
      roleMapping[role] = DEPLOYER;
    }
  } else if (config.ISOLATED_UNIVERSE) {
    // overwrite required roles with DEPLOYER
    roleMapping.ACCESS_CONTROLLER = DEPLOYER;
    roleMapping.UNIVERSE_MANAGER = DEPLOYER;
    roleMapping.EURT_LEGAL_MANAGER = DEPLOYER;
    roleMapping.PLATFORM_OPERATOR_WALLET = DEPLOYER;
    roleMapping.PLATFORM_OPERATOR_REPRESENTATIVE = DEPLOYER;
  }

  // finally override addresses and artifacts from truffle.js
  if (networkDefinition.deploymentConfigOverride) {
    config.addresses = Object.assign(
      {},
      config.addresses,
      networkDefinition.deploymentConfigOverride.addresses,
    );
    config.artifacts = Object.assign(
      {},
      config.artifacts,
      networkDefinition.deploymentConfigOverride.artifacts,
    );
  }

  return config;
}

export function getFixtureAccounts(accounts) {
  if (accounts.length < 9) {
    throw new Error("node must present at least 9 unlocked accounts for fixtures");
  }

  const makeAccount = (
    seed,
    derivationPath,
    privateKey,
    address,
    type,
    verified,
    shouldHaveEther = true,
  ) => {
    if (type !== "external") {
      // account must be unlocked
      if (!accounts.find(a => address.toLowerCase() === a.toLowerCase())) {
        throw new Error(`Account ${address} must be unlocked to use fixtures`);
      }
    }
    return { address, type, verified, shouldHaveEther };
  };

  return {
    INV_ETH_ICBM_NO_KYC: makeAccount(
      "argue resemble sustain tattoo know goat parade idea science okay loan float solution used order dune essay achieve illness keen guitar stumble idea strike",
      "m/44'/60'/0'/0",
      "0x79177f5833b64c8fdcc9862f5a779b8ff0e1853bf6e9e4748898d4b6de7e8c93",
      "0x429123b08DF32b0006fd1F3b0Ef893A8993802f3",
      "investor",
      false,
    ),

    INV_ETH_ICBM_NO_KYC_2: makeAccount(
      "force squeeze drift rigid dizzy cave random menu gap pudding trip elevator bleak essence decide camp screen glass oppose possible bunker piece merit much",
      "m/44'/60'/0'/0/0",
      "0x26725897cd95531f8f06c963a29424af96ca61684f619316752112702d58e0b0",
      "0xDE185A5c2Bd3913fAC1F64102e3DEFD9E1797C4d",
      "investor",
      false,
    ),

    INV_EUR_ICBM_HAS_KYC: makeAccount(
      "juice chest position grace weather matter turn delay space abuse winter slice tell flip use between crouch shop open leg elegant bracket lamp day",
      "m/44'/60'/0'/0",
      "0xb8c9391742bcf13c2efe56aa8d158ff8b50191a11d9fe5021d8b31cd86f96f46",
      "0xE6Ad2CdBA2FB15504232eBFa82f64c06c87F9326",
      "investor",
      true,
    ),

    INV_EUR_ICBM_HAS_KYC_2: makeAccount(
      "artwork orbit lobster supreme auto orphan quick neither stumble brown museum merit light over cube split nation divide submit diary intact junior win lens",
      "m/44'/60'/0'/0/0",
      "0x42869be50f95ccdb68c21efe2af9a3a318325b191ea86b92a54bee6c1944efa6",
      "0x619f0a73f02b8ac8F58440c21E15A461E69011a5",
      "investor",
      true,
    ),

    INV_EUR_ICBM_HAS_KYC_SEED: makeAccount(
      "ribbon unfair dial explain device weather future version wood buyer finish purchase hair million sample forward join praise input violin mercy business purse weekend",
      "m/44'/60'/0'/0/0",
      "0x4d17a67ae5e8eae9b9c86d9bc8386d83fd1c40081fa5bad7dc370d3134849a7f",
      "0xB3a2eb675288Bff642F5036235ffb541a4289E71",
      "investor",
      true,
    ),

    INV_EUR_ICBM_HAS_KYC_SEED_2: makeAccount(
      "collect oval chimney manual fancy volcano summer fish twice runway cradle filter polar bless dune flame erupt angle fly dinosaur gather bronze seek silver",
      "m/44'/60'/0'/0/0",
      "0xf8d1d4e602186bfd0b3363c54ed403d97a8041fe5703c46f8e60df92903259d3",
      "0x7b85041Fe5E05A31a961445c3321EE426015D45F",
      "investor",
      true,
    ),

    INV_ETH_EUR_ICBM_M_HAS_KYC: makeAccount(
      "then route cage lyrics arrange car pigeon gas rely canoe turn all weapon pepper lemon festival joy option drama forget tortoise useful canvas viable",
      "m/44'/60'/0'/0",
      "0xfd4f06f51658d687910bb3675b5c093d4f93fff1183110101e0101fa88e08e5a",
      "0xDf5F67E6e4c643a2ceD1f9De88A5da42E1507eFD",
      "investor",
      true,
    ),
    INV_ETH_EUR_ICBM_M_HAS_KYC_DUP: makeAccount(
      "escape filter champion bring denial siege cactus vivid used march smile over ocean repeat poet word media fluid fluid quantum faculty tattoo attract crush",
      "m/44'/60'/0'/0/0",
      "0x03e568e86b296b69d51c364053f39d7f76b76799654fa6be22b48e902b0c04ec",
      "0x7824e49353BD72E20B61717cf82a06a4EEE209e8",
      "investor",
      true,
    ),

    INV_ETH_EUR_ICBM_M_HAS_KYC_DUP_HAS_NEUR_AND_NO_ETH: makeAccount(
      "kid welcome lion describe repair champion submit sing sugar vault avoid jar adapt little page boost happy sing vivid stone web rescue grape bicycle",
      "m/44'/60'/0'/0/0",
      "0x6e6030bc2d1abf8147c6f3617b55c9fdef4814c075f8c4c192695b55cacdbf88",
      "0xA622f39780fC8722243b49ACF3bFFEEb9B9201F2",
      "investor",
      true,
      false,
    ),

    INV_ICBM_ETH_M_HAS_KYC: makeAccount(
      "mimic lumber mother guide coil theory elite fly tiny wink seed issue cupboard limb luggage reflect ladder menu menu still deny basket spring evil",
      "unknown",
      "0x8bf3960bdf2a93ae0fe95d19582a639453edbb084b7f36be7f91789da8bf0390",
      "0x00b30CC2cc22c9820d47a4E0C9E1A54455bA0883",
      "investor",
      true,
    ),
    INV_ICBM_ETH_M_HAS_KYC_DUP: makeAccount(
      "subject loan retire wash stairs joke dry boy submit already tuition sponsor focus small giggle tornado smile wheel income pudding palm zone tragic property",
      "m/44'/60'/0'/0/0",
      "0xdf6419aea83e2c8fbcba5aafee313ce55ded93b89b1b60853e95af09ca2f792b",
      "0xF7784a74Cc59d1e6e1C10ca2053f34D68d280aE7",
      "investor",
      true,
    ),

    INV_ICBM_ETH_M_HAS_KYC_DUP_2: makeAccount(
      "long ordinary situate fashion crime razor salon impact science powder aisle extra midnight dream hurt plastic bless soon viable abandon insect fabric hope brown",
      "m/44'/60'/0'/0/0",
      "0x85e93122c429e8d4422016262b5a81437d8257457eb85aa2c393c3b0f5e3ea91",
      "0xFa8ae4e924e14C834Ad48238a55A24Af97A8f3F3",
      "investor",
      true,
    ),

    INV_ICBM_ETH_M_HAS_KYC_DUP_HAS_NEURO: makeAccount(
      "subway ritual clarify city picnic mean trip vocal neglect candy gaze parrot rocket typical hammer nasty library govern engage afford smooth wild rookie able",
      "m/44'/60'/0'/0/0",
      "0x6935e67ba2870b1f236ce99fc34048b4b80ddb86f981e4c7241cab00a31583b7",
      "0x4A20381D628AEEc776335a89bb32106a8F9d4323",
      "investor",
      true,
    ),

    INV_ICBM_EUR_M_HAS_KYC: makeAccount(
      "behind cool coyote edit have demise arena glare early embrace potato tray unit repair shine huge duty hybrid relax cage embrace cinnamon please hip",
      "unknown",
      "0x86894df4dae0eec4d7d13d08c32d92e614161790accdf1820981b45e6a74f07a",
      "0x0020D330ef4De5C07D4271E0A67e8fD67A21D523",
      "investor",
      true,
    ),
    INV_HAS_EUR_HAS_KYC: makeAccount(
      "orange iron recycle unusual cannon theory myth echo dizzy prefer arrange ugly fatigue sell rain burden meadow tiny tone spy glance agent catalog clock",
      "unkown",
      "0x75130945b6fba959304790f2664a4c1c5333750b63a0dd110f49b5156397f60c",
      "0x0009C1d95C547d53E3b962059Be11802b5e85BA3",
      "investor",
      true,
    ),
    INV_HAS_ETH_T_NO_KYC: makeAccount(
      "regret neglect aware fold early ribbon hollow require inspire arm never rocket armor buddy traffic lunch provide coil foil knock hospital season annual wing",
      "unknown",
      "0xd248883d7f437e22291739a5e5e53890e454b626400b9cc0027bf41383b204ef",
      "0x008Cf11F0439C3e85f736B84244dfA04C6382c22",
      "investor",
      false,
    ),
    INV_EMPTY_HAS_KYC: makeAccount(
      "else width refuse blood month clock rib blast adjust surprise gather potato olympic post area creek power student oak inflict memory document when scene",
      "unknown",
      "0x749244a19e688fe7106b9efdc907df6376edeadc393efd9c31eb53ad025ff096",
      "0x0012f184BA450a1E4e2E90110c57D84b06354770",
      "investor",
      true,
    ),
    // nominees
    NOMINEE_NEUMINI: makeAccount(
      "faint inject car announce few flee sun sibling scheme dance oil garage pretty giggle blood box hybrid swift goose timber vanish good subway coffee",
      "unknown",
      "0x1354699398f5b5f518b9714457a24a872d4746561da0648cbe03d1785b6af649",
      "0xCB6470fa4b5D56C8f494e7c1CE56B28c548931a6",
      "nominee",
      true,
    ),
    // issuers
    ISSUER_SETUP: makeAccount(
      "rare work reason ladder hurdle junior moment sad lens panic random photo cave essence simple better merit stage road that humor term assist arrange",
      "m/44'/60'/0'/0",
      "0x941a09e617aeb905e13c58d700d48875d5f05eeec1de1981d3227e3bbc72b689",
      "0x74180B56DD74BC56a2E9D5720F39247c55F23328",
      "issuer",
      true,
    ),
    ISSUER_WHITELIST: makeAccount(
      "clarify picnic oppose degree live place want slot hospital motion voyage rent dawn daughter space image unable alone romance output maze inch addict way",
      "m/44'/60'/0'/0",
      "0x9be0993812c14583c58e4456cce1ab50ce9bd8e891eb754518c13cffc27b95c3",
      "0x8e75544B848F0a32a1Ab119E3916Ec7138f3Bed2",
      "issuer",
      true,
    ),
    ISSUER_PUBLIC: makeAccount(
      "nerve crucial garlic essence egg exclude dry expect good when brush flame lemon bird brass twin track sound civil frequent special budget start fork",
      "m/44'/60'/0'/0",
      "0x9be0993812c14583c58e4456cce1ab50ce9bd8e891eb754518c13cffc27b95c3",
      "0x16cd5aC5A1b77FB72032E3A09E91A98bB21D8988",
      "issuer",
      true,
    ),
    ISSUER_SIGNING: makeAccount(
      "skull broom ripple hour owner hurry render roof disagree drum eye narrow essay country unusual sadness jealous waste margin document east guitar tunnel dolphin",
      "m/44'/60'/0'/0",
      "0x45f9d8f48f127a4804bcd313f26f6e5cc9f1c0f6d2eae1850b935f68af417d15",
      "0xC8f867Cf4Ed30b4fF0Aa4c4c8c6b684397B219B0",
      "issuer",
      true,
    ),
    ISSUER_CLAIMS: makeAccount(
      "recall insane member poet resemble mirror royal skull observe hope avoid present broom salt twin document gorilla wage notice page tide idle cram exotic",
      "unknown",
      "0x8f39956fd29869c2a51107c19b33ea4ed531cdc3c01d8cf7a9a4dada684adc48",
      "0x007D45D94368AE57ac8351604dC1cB3236150727",
      "issuer",
      true,
    ),
    ISSUER_PAYOUT: makeAccount(
      "math friend anger chimney enable gas woman rookie lady index special clever insane dose tongue master topic current renew pact plug surprise captain today",
      "unknown",
      "0x8f39956fd29869c2a51107c19b33ea4ed531cdc3c01d8cf7a9a4dada684adc48",
      "0x00866b5e4F539b215a28476aD5A364425599F206",
      "issuer",
      true,
    ),
    ISSUER_REFUND: makeAccount(
      "volcano eye expire jaguar tail zero shrug trip creek glass receive adult shift anger ceiling man twist census blood bubble resist jelly wine cost",
      "unknown",
      "0x7a49f4cd3632a725425d233249f757f102d6774868ac4e093871375ae9aae4e1",
      "0x0028625dcBc24a821b40864294D66507fEC70B7F",
      "issuer",
      true,
    ),
    ISSUER_SETUP_NO_ST: makeAccount(
      "denial drive symbol magic staff tool across vivid lift crime switch silly loan same company robot aim pluck stereo section team one wheat desert",
      "unknown",
      "0x8822940f1f642d9ad1d08d1cf6c5bc919f33e3ceb8365e91e694cfe67578997a",
      "0x0015650359DaF66f6633DEeb490a059027B0e396",
      "issuer",
      true,
    ),
    ISSUER_PREVIEW: makeAccount(
      "suspect exist outer organ reveal large display quit skull pony citizen coconut curious brand music child cancel valid rabbit garbage burst tiny fantasy check",
      "m/44'/60'/0'/0/0",
      "0xac9c5791f78090ae521ba514cb973307c0c8e759172de86f7538085f2dd42df3",
      "0x238FB566005f59Fd5915dde954AB9FA7352Da641",
      "issuer",
      true,
    ),
    ISSUER_PENDING: makeAccount(
      "undo seek ball wagon dove region despair mountain unit paddle limb rather puppy slot disagree thunder execute garage stone use first session finger detail",
      "m/44'/60'/0'/0/0",
      "0xb5848686d0bc7e90cf0af17d539dc594d8ad5e4676f19a3e5cd7b49f7a4628e9",
      "0x0A00992Aea13E8E10287b577256717Aa4910a0Bb",
      "issuer",
      true,
    ),
    ISSUER_LISTED: makeAccount(
      "credit short venture what speak castle embark nurse juice wild holiday pulp mixed gas jelly bachelor soft novel game matrix faculty vote argue black",
      "m/44'/60'/0'/0/0",
      "0x73d36b0a24c4fd181a718672c627fd0caadd8d9ac0df72267f89f8f117d2fd39",
      "0x007fF055641147d0a170a7A73B00F0eeb2f07f12",
      "issuer",
      true,
    ),
    ISSUER_PROSPECTUS_APPROVED: makeAccount(
      "pulp car away mind fuel say swear language fade auto bottom body blame regular account cruise bread update clap language soup diagram man gate",
      "m/44'/60'/0'/0/0",
      "0x2b7dc7e315fdd1192f5c9240f9ddd1032f7696107f0d177599e1a362f1e8e054",
      "0x4B07fd23BAA7198061caEd44cF470B0F20cE1b7e",
      "issuer",
      true,
    ),
    SPARE_1: makeAccount(
      "morning panther view ahead fashion client shallow sustain tool cost illegal wish alter demise extend trend task glory alert hurdle rail fragile vital about",
      "m/44'/60'/0'/0/0",
      "0xcc5e22b1568ea35e732a0952f6d873fd06190add23bfafe312afbb465f2d98c6",
      "0x9369dFD79049B7C3CF48d54435287b0AFd5227Da",
      "investor",
      true,
    ),
    SPARE_2: makeAccount(
      "winter emerge indoor gather check ketchup fiction rotate actress hammer antenna brown bubble primary fury various put gallery scheme reform harsh inflict agent ball",
      "m/44'/60'/0'/0/0",
      "0x87d63fa9252e2bdc5122559618c3726fe5f4539ab94b5220d1060b7df498f199",
      "0xE52Df6021c75f8DDf20Ab4dfC818Bce84f7cBD5D",
      "investor",
      true,
    ),
    SPARE_3: makeAccount(
      "cricket index proud frame aerobic swear certain decrease vacant quick clock fantasy flock napkin puzzle tackle pony camp test property one garlic voice decline",
      "m/44'/60'/0'/0/0",
      "0xbd3861e2a5999d22a99531f8b028e7ea15e788625a8fd19dd4959479fb93dc6f",
      "0x798fD195575d195B9Bb9619ffb905E434f044f1D",
      "investor",
      true,
    ),
    SPARE_4: makeAccount(
      "tourist voice pilot search buyer parrot maid flush pulse silver void liar provide cushion burden mean relax oven plastic vessel grunt black twice vast",
      "m/44'/60'/0'/0/0",
      "0x797a981f658de6799b6dc1b079a6af3f4feaea5f23133f3c2c054ddfeee60ab8",
      "0xC35ef5DA2607C70D812cA2F317E9958910450dF1",
      "investor",
      true,
    ),
    // external accounts
    NANO_1: makeAccount(
      "stored on nano",
      "unknown",
      "stored on nano",
      "0x79fe3C2DC5da59A5BEad8Cf71B2406Ad22ed2B3D",
      "external",
      false,
    ),
    NANO_2: makeAccount(
      "stored on nano",
      "unknown",
      "stored on nano",
      "0x97d2e2Bf8EeDB82300B3D07Cb097b8f97Dc5f47C",
      "external",
      false,
    ),
    NANO_3: makeAccount(
      "stored on nano",
      "unknown",
      "stored on nano",
      "0xaa4689311f3C3E88848CFd90f7dAA25eA2aacDD3",
      "external",
      false,
    ),
  };
}
