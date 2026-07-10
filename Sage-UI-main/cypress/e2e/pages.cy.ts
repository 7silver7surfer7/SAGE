describe('pages', () => {
  context('home-page', () => {
    it('successfully-loads', () => {
      cy.visit('/');
    });
    it('featured drops section is available on home page', () => {
      //wait for entry animation to finish
      // cy.wait(1000);
      cy.dataCy('featured-drops');
    });
    it('clicking on a drop tile goes to a drop page', () => {
      cy.dataCy('featured-drops').children().first().click();
      cy.wait(1000);
      cy.url().should('include', 'drops');
      cy.go('back');
    });
    it('footer is available on home page', () => {
      cy.dataCy('footer');
    });
    it('nav bar is available on home page', () => {
      cy.dataCy('nav');
    });
  });
});
