const {findNFreePorts} = require("../utils/net");

const mapAccountNameToPort = {};
const mapPortToAccountName = {};

let socketIOServerPort = 0;
const getSocketIOServerPort = async () => {
    if (!socketIOServerPort) {
        const ports = await findNFreePorts(1, 5000, 65535);
        socketIOServerPort = ports[0];
    }
    return socketIOServerPort;
};

module.exports = {mapAccountNameToPort, mapPortToAccountName, getSocketIOServerPort};
