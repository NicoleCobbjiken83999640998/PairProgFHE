// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SecureCloudIDE is SepoliaConfig {
    struct EncryptedSession {
        uint256 id;
        euint32 encryptedCode;       // Encrypted code content
        euint32 encryptedCursorPos;  // Encrypted cursor position
        address owner;
        address[] collaborators;
        uint256 timestamp;
    }
    
    struct DecryptedSession {
        string codeContent;
        uint32 cursorPosition;
        bool isRevealed;
    }

    // Contract state
    uint256 public sessionCount;
    mapping(uint256 => EncryptedSession) public encryptedSessions;
    mapping(uint256 => DecryptedSession) public decryptedSessions;
    mapping(uint256 => mapping(address => bool)) public sessionPermissions;
    
    // Track decryption requests
    mapping(uint256 => uint256) private requestToSessionId;
    
    // Events
    event SessionCreated(uint256 indexed id, address owner);
    event CollaboratorAdded(uint256 indexed id, address collaborator);
    event CodeUpdated(uint256 indexed id);
    event DecryptionRequested(uint256 indexed id);
    event SessionDecrypted(uint256 indexed id);

    /// @dev Modifier to restrict access to session participants
    modifier onlyParticipant(uint256 sessionId) {
        require(
            encryptedSessions[sessionId].owner == msg.sender || 
            sessionPermissions[sessionId][msg.sender],
            "Not authorized"
        );
        _;
    }

    /// @dev Modifier to check session existence
    modifier sessionExists(uint256 sessionId) {
        require(encryptedSessions[sessionId].id != 0, "Session not found");
        _;
    }

    /// @notice Create a new encrypted coding session
    function createEncryptedSession(
        euint32 encryptedInitialCode,
        euint32 encryptedInitialCursor
    ) public {
        sessionCount++;
        uint256 newId = sessionCount;
        address[] memory initialCollaborators = new address[](0);
        
        encryptedSessions[newId] = EncryptedSession({
            id: newId,
            encryptedCode: encryptedInitialCode,
            encryptedCursorPos: encryptedInitialCursor,
            owner: msg.sender,
            collaborators: initialCollaborators,
            timestamp: block.timestamp
        });
        
        decryptedSessions[newId] = DecryptedSession({
            codeContent: "",
            cursorPosition: 0,
            isRevealed: false
        });
        
        emit SessionCreated(newId, msg.sender);
    }

    /// @notice Add collaborator to coding session
    function addCollaborator(
        uint256 sessionId, 
        address collaborator
    ) public sessionExists(sessionId) {
        require(
            encryptedSessions[sessionId].owner == msg.sender,
            "Only owner can add collaborators"
        );
        require(
            !sessionPermissions[sessionId][collaborator],
            "Already a collaborator"
        );
        
        encryptedSessions[sessionId].collaborators.push(collaborator);
        sessionPermissions[sessionId][collaborator] = true;
        
        emit CollaboratorAdded(sessionId, collaborator);
    }

    /// @notice Update encrypted code content
    function updateEncryptedCode(
        uint256 sessionId,
        euint32 newEncryptedCode
    ) public sessionExists(sessionId) onlyParticipant(sessionId) {
        encryptedSessions[sessionId].encryptedCode = newEncryptedCode;
        encryptedSessions[sessionId].timestamp = block.timestamp;
        emit CodeUpdated(sessionId);
    }

    /// @notice Update encrypted cursor position
    function updateCursorPosition(
        uint256 sessionId,
        euint32 newEncryptedCursor
    ) public sessionExists(sessionId) onlyParticipant(sessionId) {
        encryptedSessions[sessionId].encryptedCursorPos = newEncryptedCursor;
    }

    /// @notice Request decryption of session data
    function requestSessionDecryption(
        uint256 sessionId
    ) public sessionExists(sessionId) onlyParticipant(sessionId) {
        require(!decryptedSessions[sessionId].isRevealed, "Already decrypted");
        
        EncryptedSession storage session = encryptedSessions[sessionId];
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(session.encryptedCode);
        ciphertexts[1] = FHE.toBytes32(session.encryptedCursorPos);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptSession.selector);
        requestToSessionId[reqId] = sessionId;
        
        emit DecryptionRequested(sessionId);
    }

    /// @notice Handle decryption callback
    function decryptSession(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 sessionId = requestToSessionId[requestId];
        require(sessionId != 0, "Invalid request");
        
        EncryptedSession storage eSession = encryptedSessions[sessionId];
        DecryptedSession storage dSession = decryptedSessions[sessionId];
        require(!dSession.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory code, uint32 cursor) = abi.decode(cleartexts, (string, uint32));
        
        dSession.codeContent = code;
        dSession.cursorPosition = cursor;
        dSession.isRevealed = true;
        
        emit SessionDecrypted(sessionId);
    }

    /// @notice Get session collaborators
    function getCollaborators(
        uint256 sessionId
    ) public view sessionExists(sessionId) returns (address[] memory) {
        return encryptedSessions[sessionId].collaborators;
    }

    /// @notice Get encrypted code content
    function getEncryptedCode(
        uint256 sessionId
    ) public view sessionExists(sessionId) onlyParticipant(sessionId) returns (euint32) {
        return encryptedSessions[sessionId].encryptedCode;
    }

    /// @notice Get decrypted session data
    function getDecryptedSession(
        uint256 sessionId
    ) public view sessionExists(sessionId) onlyParticipant(sessionId) returns (
        string memory,
        uint32,
        bool
    ) {
        DecryptedSession storage session = decryptedSessions[sessionId];
        return (session.codeContent, session.cursorPosition, session.isRevealed);
    }
}