FROM node:8-alpine

# Metadata
LABEL org.label-schema.vendor="Neufund" \
    org.label-schema.url="https://neufund.org" \
    org.label-schema.name="Platform Contracts" \
    org.label-schema.description="Platform smart contract and build + deploy pipeline" \
    org.label-schema.version="0.0.1" \
    org.label-schema.vcs-url="https://github.com/Neufund/platform-contracts" \
    org.label-schema.docker.schema-version="1.0"

RUN apk --update add git openssh make gcc g++ python bash && \
    rm -rf /var/lib/apt/lists/* && \
    rm /var/cache/apk/*
# add full permissions to anyone as we intend to run commands on host users
RUN mkdir -p /usr/src/platform-contracts && chmod 777 /usr/src/platform-contracts
WORKDIR /usr/src/platform-contracts
# only things required by yarn install
ADD .babelrc package.json yarn.lock ./
RUN yarn --production
# all other files
ADD bin/solc.4.25 /usr/bin/
ADD scripts scripts
RUN ./scripts/solctruffle.sh
ADD contracts contracts
RUN find ./contracts/ -exec touch -t 200906122350 {} \;
ADD legal legal
ADD migrations migrations
RUN mkdir -p test
ADD test/helpers test/helpers
ADD mocha.js nanoWeb3Provider.js multiWalletProvider.js truffle.js ./
