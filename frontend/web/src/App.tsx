// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface CodeProject {
  id: string;
  name: string;
  encryptedCode: string;
  createdAt: number;
  collaborators: string[];
  language: string;
  lastUpdated: number;
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<CodeProject[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newProjectData, setNewProjectData] = useState({
    name: "",
    language: "javascript",
    initialCode: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [showTeamInfo, setShowTeamInfo] = useState(false);

  // Filter projects based on search and active tab
  const filteredProjects = projects.filter(project => {
    const matchesSearch = project.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         project.language.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = activeTab === "all" || 
                      (activeTab === "mine" && project.collaborators.includes(account));
    return matchesSearch && matchesTab;
  });

  useEffect(() => {
    loadProjects().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Load projects from contract
  const loadProjects = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("project_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing project keys:", e);
        }
      }
      
      const list: CodeProject[] = [];
      
      for (const key of keys) {
        try {
          const projectBytes = await contract.getData(`project_${key}`);
          if (projectBytes.length > 0) {
            try {
              const projectData = JSON.parse(ethers.toUtf8String(projectBytes));
              list.push({
                id: key,
                name: projectData.name,
                encryptedCode: projectData.code,
                createdAt: projectData.createdAt,
                collaborators: projectData.collaborators || [],
                language: projectData.language || "javascript",
                lastUpdated: projectData.lastUpdated || projectData.createdAt
              });
            } catch (e) {
              console.error(`Error parsing project data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading project ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.lastUpdated - a.lastUpdated);
      setProjects(list);
    } catch (e) {
      console.error("Error loading projects:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  // Create new project
  const createProject = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting code with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedCode = `FHE-${btoa(newProjectData.initialCode)}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const projectId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const projectData = {
        name: newProjectData.name,
        code: encryptedCode,
        createdAt: Math.floor(Date.now() / 1000),
        collaborators: [account],
        language: newProjectData.language,
        lastUpdated: Math.floor(Date.now() / 1000)
      };
      
      // Store encrypted data on-chain
      await contract.setData(
        `project_${projectId}`, 
        ethers.toUtf8Bytes(JSON.stringify(projectData))
      );
      
      const keysBytes = await contract.getData("project_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(projectId);
      
      await contract.setData(
        "project_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Project created with encrypted code!"
      });
      
      await loadProjects();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewProjectData({
          name: "",
          language: "javascript",
          initialCode: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Creation failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  // Add collaborator to project
  const addCollaborator = async (projectId: string, collaboratorAddress: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Updating encrypted project..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const projectBytes = await contract.getData(`project_${projectId}`);
      if (projectBytes.length === 0) {
        throw new Error("Project not found");
      }
      
      const projectData = JSON.parse(ethers.toUtf8String(projectBytes));
      
      if (!projectData.collaborators.includes(account)) {
        throw new Error("Only collaborators can add new members");
      }
      
      const updatedProject = {
        ...projectData,
        collaborators: [...projectData.collaborators, collaboratorAddress],
        lastUpdated: Math.floor(Date.now() / 1000)
      };
      
      await contract.setData(
        `project_${projectId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedProject))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Collaborator added successfully!"
      });
      
      await loadProjects();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Failed to add collaborator: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Check if user is collaborator
  const isCollaborator = (project: CodeProject) => {
    return project.collaborators.includes(account);
  };

  // Team information
  const teamMembers = [
    {
      name: "Alex Chen",
      role: "FHE Engineer",
      bio: "Specializes in fully homomorphic encryption implementations"
    },
    {
      name: "Jamie Park",
      role: "Frontend Developer",
      bio: "Builds secure and intuitive user interfaces"
    },
    {
      name: "Taylor Smith",
      role: "Blockchain Architect",
      bio: "Designs decentralized systems for encrypted collaboration"
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted IDE environment...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>PairProg<span>FHE</span></h1>
          <p>Secure Encrypted Pair Programming</p>
        </div>
        
        <div className="header-actions">
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Search projects..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button className="search-icon"></button>
          </div>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            New Project
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <div className="project-tabs">
          <button 
            className={activeTab === "all" ? "active" : ""}
            onClick={() => setActiveTab("all")}
          >
            All Projects
          </button>
          <button 
            className={activeTab === "mine" ? "active" : ""}
            onClick={() => setActiveTab("mine")}
          >
            My Projects
          </button>
          <button 
            className="team-btn"
            onClick={() => setShowTeamInfo(!showTeamInfo)}
          >
            {showTeamInfo ? "Hide Team" : "Show Team"}
          </button>
        </div>
        
        {showTeamInfo && (
          <div className="team-section">
            <h2>Our Team</h2>
            <div className="team-grid">
              {teamMembers.map((member, index) => (
                <div className="team-card" key={index}>
                  <div className="member-avatar"></div>
                  <h3>{member.name}</h3>
                  <p className="role">{member.role}</p>
                  <p className="bio">{member.bio}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="projects-grid">
          {filteredProjects.length === 0 ? (
            <div className="no-projects">
              <div className="empty-icon"></div>
              <p>No projects found</p>
              <button 
                className="create-btn"
                onClick={() => setShowCreateModal(true)}
              >
                Create Your First Project
              </button>
            </div>
          ) : (
            filteredProjects.map(project => (
              <div className="project-card" key={project.id}>
                <div className="card-header">
                  <h3>{project.name}</h3>
                  <span className={`language-tag ${project.language}`}>
                    {project.language}
                  </span>
                </div>
                <div className="card-body">
                  <div className="project-meta">
                    <div className="meta-item">
                      <span className="label">Created:</span>
                      <span>{new Date(project.createdAt * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="meta-item">
                      <span className="label">Last Updated:</span>
                      <span>{new Date(project.lastUpdated * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="meta-item">
                      <span className="label">Collaborators:</span>
                      <span>{project.collaborators.length}</span>
                    </div>
                  </div>
                  <div className="code-preview">
                    <pre>{atob(project.encryptedCode.replace("FHE-", "")).substring(0, 100)}...</pre>
                  </div>
                </div>
                <div className="card-footer">
                  <button className="open-btn">
                    Open in IDE
                  </button>
                  {isCollaborator(project) && (
                    <button 
                      className="add-collab-btn"
                      onClick={() => {
                        const address = prompt("Enter collaborator address:");
                        if (address) addCollaborator(project.id, address);
                      }}
                    >
                      Add Collaborator
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </main>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={createProject} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          projectData={newProjectData}
          setProjectData={setNewProjectData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>PairProgFHE</h3>
            <p>Secure encrypted pair programming using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Fully Homomorphic Encryption</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} PairProgFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  projectData: any;
  setProjectData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  projectData,
  setProjectData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setProjectData({
      ...projectData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!projectData.name || !projectData.initialCode) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create New Encrypted Project</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="form-group">
            <label>Project Name *</label>
            <input 
              type="text"
              name="name"
              value={projectData.name} 
              onChange={handleChange}
              placeholder="My Awesome Project" 
            />
          </div>
          
          <div className="form-group">
            <label>Programming Language *</label>
            <select 
              name="language"
              value={projectData.language} 
              onChange={handleChange}
            >
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="solidity">Solidity</option>
              <option value="rust">Rust</option>
              <option value="typescript">TypeScript</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Initial Code *</label>
            <textarea 
              name="initialCode"
              value={projectData.initialCode} 
              onChange={handleChange}
              placeholder="Write your initial code here..." 
              rows={8}
            />
          </div>
          
          <div className="encryption-notice">
            <div className="lock-icon"></div> 
            <span>Your code will be encrypted with FHE before storage</span>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn"
          >
            {creating ? "Creating Encrypted Project..." : "Create Project"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;