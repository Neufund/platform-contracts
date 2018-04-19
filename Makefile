help:
	@echo "container - builds development/testing container"

container:
	docker build . -t neufund/platform-contracts

run:
	docker run -it -p 8545:8545 --name platform-contracts --rm neufund/platform-contracts yarn testrpc

deploy:
	docker exec platform-contracts yarn deploy localhost
