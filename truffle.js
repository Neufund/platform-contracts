/* eslint-disable global-require */
require("babel-register");
require("babel-polyfill");
const Ganache = require("ganache-core");
const HDWalletProvider = require("truffle-hdwallet-provider");

const fixtures_accounts_private_keys = [
  "0x2a9f4a59835a4cd455c9dbe463dcdf1b11b937e610d005c6b46300f0fa98d0b1",
  "0x79177f5833b64c8fdcc9862f5a779b8ff0e1853bf6e9e4748898d4b6de7e8c93",
  "0xb8c9391742bcf13c2efe56aa8d158ff8b50191a11d9fe5021d8b31cd86f96f46",
  "0xfd4f06f51658d687910bb3675b5c093d4f93fff1183110101e0101fa88e08e5a",
  "0x1354699398f5b5f518b9714457a24a872d4746561da0648cbe03d1785b6af649",
  "0x941a09e617aeb905e13c58d700d48875d5f05eeec1de1981d3227e3bbc72b689",
  "0x9be0993812c14583c58e4456cce1ab50ce9bd8e891eb754518c13cffc27b95c3",
  "0x7584f650f14599bf2d7e1692c2724d01bfa1ccaa8197ed8d34e0c6aed70e0dfe",
  "0x45f9d8f48f127a4804bcd313f26f6e5cc9f1c0f6d2eae1850b935f68af417d15",
  "0x8bf3960bdf2a93ae0fe95d19582a639453edbb084b7f36be7f91789da8bf0390",
  "0x86894df4dae0eec4d7d13d08c32d92e614161790accdf1820981b45e6a74f07a",
  "0x75130945b6fba959304790f2664a4c1c5333750b63a0dd110f49b5156397f60c",
  "0xd248883d7f437e22291739a5e5e53890e454b626400b9cc0027bf41383b204ef",
  "0x749244a19e688fe7106b9efdc907df6376edeadc393efd9c31eb53ad025ff096",
  "0xa81a2bc577ac9631abae432ee8a10660c5a7c948bfe5695da7b7874e858ad1d6",
  "0x8f39956fd29869c2a51107c19b33ea4ed531cdc3c01d8cf7a9a4dada684adc48",
  "0x7a49f4cd3632a725425d233249f757f102d6774868ac4e093871375ae9aae4e1",
  "0x8822940f1f642d9ad1d08d1cf6c5bc919f33e3ceb8365e91e694cfe67578997a",
  "0xac9c5791f78090ae521ba514cb973307c0c8e759172de86f7538085f2dd42df3",
  "0xb5848686d0bc7e90cf0af17d539dc594d8ad5e4676f19a3e5cd7b49f7a4628e9",
  "0x73d36b0a24c4fd181a718672c627fd0caadd8d9ac0df72267f89f8f117d2fd39",
  "0x2b7dc7e315fdd1192f5c9240f9ddd1032f7696107f0d177599e1a362f1e8e054",
  "0xcc5e22b1568ea35e732a0952f6d873fd06190add23bfafe312afbb465f2d98c6",
  "0x87d63fa9252e2bdc5122559618c3726fe5f4539ab94b5220d1060b7df498f199",
  "0xdf6419aea83e2c8fbcba5aafee313ce55ded93b89b1b60853e95af09ca2f792b",
  "0x03e568e86b296b69d51c364053f39d7f76b76799654fa6be22b48e902b0c04ec",
  "0xbd3861e2a5999d22a99531f8b028e7ea15e788625a8fd19dd4959479fb93dc6f",
  "0x797a981f658de6799b6dc1b079a6af3f4feaea5f23133f3c2c054ddfeee60ab8",
  "0x26725897cd95531f8f06c963a29424af96ca61684f619316752112702d58e0b0",
  "0x4d17a67ae5e8eae9b9c86d9bc8386d83fd1c40081fa5bad7dc370d3134849a7f",
  "0xf8d1d4e602186bfd0b3363c54ed403d97a8041fe5703c46f8e60df92903259d3",
  "0x6e6030bc2d1abf8147c6f3617b55c9fdef4814c075f8c4c192695b55cacdbf88",
  "0x85e93122c429e8d4422016262b5a81437d8257457eb85aa2c393c3b0f5e3ea91",
  "0x6935e67ba2870b1f236ce99fc34048b4b80ddb86f981e4c7241cab00a31583b7",
];

// dev network override
const now = Math.floor(new Date().getTime() / 1000);
const devNetworkDeploymentConfigOverride = {
  // give 5 minutes for deployment - Commitment deployment will fail if less than 24h from beginning
  START_DATE: now + 1 * 24 * 60 * 60 + 5 * 60,
  // setup mocked artifacts
  artifacts: {
    ICBM_COMMITMENT: "MockICBMCommitment",
    STANDARD_ETO_COMMITMENT: "MockETOCommitment",
  },
  // other addresses set to DEPLOYER
  addresses: {
    EURT_DEPOSIT_MANAGER: "0x9058B511C7450303F5Bc187aAf4cC25d7f7F88C6",
    IDENTITY_MANAGER: "0xF08E9c0FcC6A3972c5Fd80fF7D478E0Db3091768",
    GAS_EXCHANGE: "0x81cE04F4015077E53f01c2881865D78496861369",
    TOKEN_RATE_ORACLE: "0xB3E69d2637076D265bFb056bF5F35d9155535CD6",
    GAS_STIPEND_SERVICE: "0x29c57b5F27b249Ab3c11Badf6efc4B2308bc75Dd",
  },
};
// forked mainnet override
const forkedLiveNetworkDeploymentConfigOverride = {
  ICBM_COMMITMENT_ADDRESS: "0xf432cec23b2a0d6062b969467f65669de81f4653",
  UNIVERSE_ADDRESS: "0x2785279ef76d21d39ad9a5a495955b77dedad528",
  ISOLATED_UNIVERSE: false,
  // other addresses preserve ICBM or set to DEPLOYER
  addresses: {
    EURT_DEPOSIT_MANAGER: "0x9058B511C7450303F5Bc187aAf4cC25d7f7F88C6",
    IDENTITY_MANAGER: "0xF08E9c0FcC6A3972c5Fd80fF7D478E0Db3091768",
    GAS_EXCHANGE: "0x81cE04F4015077E53f01c2881865D78496861369",
    TOKEN_RATE_ORACLE: "0xB3E69d2637076D265bFb056bF5F35d9155535CD6",
    GAS_STIPEND_SERVICE: "0x29c57b5F27b249Ab3c11Badf6efc4B2308bc75Dd",
  },
};

const nanoProvider = (providerUrl, nanoPath, network) =>
  process.argv.some(arg => arg === network)
    ? require("./nanoWeb3Provider").nanoWeb3Provider(providerUrl, nanoPath)
    : undefined;

module.exports = {
  networks: {
    localhost: {
      provider: () => {
        return new HDWalletProvider(
          fixtures_accounts_private_keys,
          "http://localhost:8545",
          0,
          fixtures_accounts_private_keys.length,
          "m/44'/60'/0'/0",
        );
      },
      network_id: "*",
      gas: 6700000,
      gasPrice: 21000000000,
      deploymentConfigOverride: devNetworkDeploymentConfigOverride,
    },
    inprocess: {
      network_id: "*",
      provider: Ganache.provider({
        gasLimit: 6700000,
        accounts: Array(10).fill({ balance: "12300000000000000000000000" }),
      }),
    },
    nf_private: {
      provider: () => {
        return new HDWalletProvider(
          fixtures_accounts_private_keys,
          "https://parity-instant-seal-byzantium-enabled:8545",
          0,
          fixtures_accounts_private_keys.length,
        );
      },
      network_id: "17",
      gas: 6700000,
      gasPrice: 21000000000,
      deploymentConfigOverride: devNetworkDeploymentConfigOverride,
    },
    nf_private_io: {
      host: "dev02.neudev.net",
      port: 8545,
      network_id: "17",
      gas: 6700000,
      gasPrice: 21000000000,
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
      deploymentConfigOverride: devNetworkDeploymentConfigOverride,
    },
    coverage: {
      network_id: "*",
      gas: 0xfffffffffff,
      gasPrice: 1,
      host: "localhost",
      port: 8555,
    },
    forked_live: {
      network_id: 72,
      host: "ethexp-node.neustg.net",
      port: 8545,
      gas: 6500000, // close to current mainnet limit
      gasPrice: 5000000000,
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
      deploymentConfigOverride: forkedLiveNetworkDeploymentConfigOverride,
    },
    forked_nano_live: {
      network_id: 72,
      gas: 6500000,
      provider: nanoProvider(
        "http://ethexp-node.neustg.net:8545",
        // "44'/60'/0'/1",
        // "44'/60'/105'/2", // eurt legal manager
        "44'/60'/105'/10",
        // "44'/60'/105'/11",
        "forked_nano_live",
      ),
      deploymentConfigOverride: forkedLiveNetworkDeploymentConfigOverride,
      // from: "0x08712307a86632b15d13ecfebe732c07cc026915", // -> for deployment "44'/60'/105'/11"
      gasPrice: 10000000000, // 10 gwei /shannon
    },
    live: {
      network_id: 1, // Ethereum public network
      host: "eth-node.neuprd.net",
      port: 8545,
      gas: 6500000, // close to current mainnet limit
      gasPrice: 5000000000, // 21 gwei /shannon
      deploymentConfigOverride: {
        ICBM_COMMITMENT_ADDRESS: "0xf432cec23b2a0d6062b969467f65669de81f4653",
        UNIVERSE_ADDRESS: "0x82fb5126506b6c315fa4a7ae3d4cb8a46a1aae67",
        ISOLATED_UNIVERSE: false,
      },
      // optional config values
      // host - defaults to "localhost"
      // port - defaults to 8545
      // gas
      // gasPrice
      // from - default address to use for any transaction Truffle makes during migrations
    },
    nano_live: {
      network_id: 1,
      gas: 6500000,
      provider: nanoProvider(
        "http://eth-node.neuprd.net:8545",
        // "44'/60'/0'/0",
        "44'/60'/105'/3", // reclaimer
        // "44'/60'/105'/11",
        "nano_live",
      ),
      deploymentConfigOverride: {
        ICBM_COMMITMENT_ADDRESS: "0xf432cec23b2a0d6062b969467f65669de81f4653",
        UNIVERSE_ADDRESS: "0x82fb5126506b6c315fa4a7ae3d4cb8a46a1aae67",
        ISOLATED_UNIVERSE: false,
      },
      gasPrice: 10000000000, // 10 gwei /shannon
    },
    localhost_live: {
      network_id: "*",
      host: "localhost",
      port: 8545,
      gas: 6500000,
      gasPrice: 8000000000,
      from: "0x8a194c13308326173423119f8dcb785ce14c732b",
      deploymentConfigOverride: {
        ICBM_COMMITMENT_ADDRESS: "0x5b8ce2b715522998053fe2cead3e70f9a2b6ea17",
        ISOLATED_UNIVERSE: true,
      },
    },
    inprocess_test: {
      network_id: "*",
      provider: Ganache.provider({
        gasLimit: 6700000,
        accounts: Array(10).fill({ balance: "12300000000000000000000000" }),
      }),
      gas: 6700000,
    },
    localhost_test: {
      network_id: "*",
      host: "localhost",
      port: 8545,
      gas: 6700000,
    },
    inprocess_massive_test: {
      network_id: "*",
      gas: 0xffffffff,
      provider: Ganache.provider({
        deterministic: true,
        gasLimit: 0xffffffff,
        accounts: Array(100).fill({ balance: "12300000000000000000000000" }),
      }),
    },
  },
};
