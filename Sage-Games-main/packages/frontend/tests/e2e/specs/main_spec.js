
describe("Account", () => {
  before(() => {
    cy.visit(Cypress.config().baseUrl);
  });

  it("User can connect with MetaMask", () => {
    cy.get("[data-cy=connect-button]").contains("connect").click();
    cy.get("div").contains("MetaMask").click();
  });

  it.skip("URL check", () => {
    cy.url().should("include", "local");
  });

  it("Displays User Address, once connected", () => {
    cy.getMetamaskWalletAddress().then((address) => {
      const addressDisplay = `${address.slice(0, 4)}...${address.slice(-4)}`;
      cy.get("[data-cy=connect-button]").contains(addressDisplay);
    });
  });

  it("User dropdown displays points earned", () => {
    cy.get("[data-cy=user-menu]").click();
    cy.contains("Points:");
  });

  it.skip("User can Join Meme", () => {
    cy.get("div").contains("Profile").click();
  });

  it.skip("Displays User Info", () => {
    cy.contains("Meme Balance");
    cy.contains("Liquidity On Wallet");
    cy.contains("Points Available");
    cy.contains("Close").click();
  });

  it("User can edit username", () => {
    //Land on page and click edit button
    cy.get("[data-cy=user-menu]").contains("Profile").click({force : true});
    cy.get("[data-cy=edit-button]").click();
    
    //Enter username value and save
    cy.get("[data-cy=profile-username]").type("John Doe").should("have.value", "John Doe");
    cy.get("[data-cy=save-button]").click();
    cy.wait(2000);

    //Verify username
    cy.get("[data-cy=edit-button]").click();
    cy.get("div>input").eq(0).invoke("attr", "placeholder").should("contain", "John Doe");
  });

  it("User can edit email", () => {
    //Enter email value and save
    cy.get("[data-cy=profile-email]").type("johndoe@email.com").should("have.value", "johndoe@email.com");
    cy.get("[data-cy=save-button]").click();
    cy.wait(2000);

    //Verify email
    cy.get("[data-cy=edit-button]").click();
    cy.get("div>input").eq(1).invoke("attr", "placeholder").should("contain", "johndoe@email.com");
  });

  it("User can edit bio", () => {
    //Enter bio value and save
    cy.get("[data-cy=profile-bio]").type("Hello, I'm John!").should("have.value", "Hello, I'm John!");
    cy.get("[data-cy=save-button]").click();
    cy.wait(5000);

    //Verify bio
    cy.get("[data-cy=edit-button]").click();
    cy.get("div>input").eq(2).invoke("attr", "placeholder").should("contain", "Hello, I'm John!");
    cy.get("[data-cy=cancel-button]").click();
  });

  it("Username appears on user menu", () => {
    cy.get("[data-cy=user-menu]").contains("John Doe");
  });

  it("Username appears in profile user section", () => {
    cy.get("[data-cy=user_section-username]").contains("John Doe");
  });

  it("Can like drop", () => {
    //Find drop and click the like button
    cy.get("[data-cy=Drops]").click();
    cy.wait(3000);
    cy.get("[data-cy=like-button]").eq(0).click();
    cy.wait(2000);

    //Verify drop was liked
    cy.get("[data-cy=heart-img]").invoke("attr", "src").should("contain", "/_next/image/?url=%2Fheartred.svg&w=32&q=75")
    cy.wait(2000);
  });

  it("Can unlike drop", () => {
    //Click like button again
    cy.get("[data-cy=like-button]").eq(0).click();
    cy.wait(2000);

    //Verify drop is unliked
    cy.get("[data-cy=heart-img]").invoke("attr", "src").should("contain", "/_next/image/?url=%2Fheart.svg&w=32&q=75")
  });

  it('Drop share button copies correct url', { browser: 'chrome' }, () => {
    // use the Chrome debugger protocol to grant the current browser window
    // access to the clipboard from the current origin
    // Using cy.wrap to wait for the promise returned
    // from the Cypress.automation call, so the test continues
    // after the clipboard permission has been granted
    cy.wrap(Cypress.automation('remote:debugger:protocol', {
      command: 'Browser.grantPermissions',
      params: {
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
        // make the permission tighter by allowing the current origin only
        origin: window.location.origin,
      },
    }));
    
    //Checking to see if clipboard-read permission was granted
    cy.window().its('navigator.permissions').invoke('query', { name: 'clipboard-read' }).its('state').should('equal', 'granted')

    //Go to drop
    cy.get("[data-cy=go_to_drop-button]").eq(0).click();
    cy.wait(5000);
    
    //click share button
    cy.get("[data-cy=share-button]").click();

    //Get current drop url
    cy.url().then(url => {
      //Check that clipboard contains the drop url
      cy.window().its('navigator.clipboard').invoke('readText').should("contain", url);
    });
    cy.wait(2000);
});

  it("User can disconnect wallet", () => {
    cy.get("[data-cy=disconnect-button]").contains("Disconnect").click({force : true});
    cy.get("[data-cy=connect-button]").contains("connect");
    cy.get("[data-cy=user-menu]").should("not.exist");
  });
});

describe("Dark Mode", () => {
  it("Can toggle theme", () => {
    cy.get("[data-cy=layout]").should("not.have.class", "invert");
    cy.get("[data-cy=theme-toggle]").click();
    cy.get("[data-cy=layout]").should("have.class", "invert");
  });
});

describe("Navigation", () => {
  it.skip("Forums link works", () => {
    //TODO: add forums link (does not yet exist)
  });

  it.skip("Governance link works", () => {
    //TODO: add governance link (does not yet exist)
  });

  it("Marketplace link works", () => {
    cy.get("[data-cy=Marketplace]").click();
    cy.url().should("include", Cypress.config().baseUrl + "marketplace/");
  });

  it("Drops link works", () => {
    cy.get("[data-cy=Drops]").click();
    cy.url().should("eq", Cypress.config().baseUrl);
  });

  it("Twitter link works", () => {
    //TODO: cypress tests for external links
  });
  
  it.skip("Telegram link works", () => {
    //TODO: cypress tests for external links
  });

  it("Discord link works", () => {
    //TODO: cypress tests for external links
  });

  it.skip("OpenSea link works", () => {
    cy.get("[data-cy=OpenSea]").then((link) => {
      cy.request(link.prop("[data-link]")).its("status").should("eq", 200);
    });
  });

  it.skip("Email link works", () => {
    cy.get("[data-cy=Email]").then((link) => {
      cy.request(link.prop("[data-link]")).its("status").should("eq", 200);
    });
  });

  it("Rewards link works", () => {
    cy.get("[data-cy=connect-button]").contains("connect").click();
    cy.get("[data-cy=Rewards]").click();
    cy.url().should("include", "/rewards");
    cy.wait(3000);
  });

  it.skip("Nav can be toggled", () => {
    cy.get("[data-cy=nav-toggle]").click();
    cy.get("[data-cy=nav]").should("have.class", "hidden");
    cy.wait(1000);
    cy.get("[data-cy=nav-toggle]").click();
  });

  it("Footer is visible", () => {
    cy.get("[data-cy=footer]").contains("2021 MemeX");
  });

  it("Language menu works", () => {
    cy.contains("EN");
    cy.get("[data-cy=lang-btn]").click();
    cy.contains("English");
    cy.get("[data-cy=lang-btn]").click();
  });
});

describe("Search", () => {
  it.skip("Users can type in the search bar", () => {
    cy.get("[data-cy=open-search").click();
    cy.get("[data-cy=search-input]").type("Pineapple");
    cy.get("[data-cy=search-input]").should("have.value", "Pineapple");
  });

  it.skip("Enter key submits and clears input", () => {
    cy.get("[data-cy=search-input]").type("{enter}");
    cy.get("[data-cy=search-input]").should("have.value", "");
  });
});
