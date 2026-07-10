import Logotype from '@/components/Logotype';
import { Text, Subheader, Group, List } from '@/components/Static';
export default function privacypolicy() {
  return (
    <div className='submissions-page'>
      <div className='submissions-page__logotype-container'>
        <Logotype></Logotype>
      </div>
      {/* <h1 className='submissions-page__header'>
        Privacy <br /> Policy
      </h1> */}
      <section className='submissions-page__main'>
        <div className='submissions-page__main-left'>
          <AutomatedCopy />
        </div>
      </section>
    </div>
  );
}

function AutomatedCopy() {
  return (
    <>
      <h1 className='submissions-page__header'>PRIVACY POLICY</h1>
      <p className='submissions-page__guidelines-text'>
        SAGE WEB3 INC. (&ldquo;SAGE&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;. &ldquo;our&rdquo;)
        provides the following Privacy Policy to users of SAGE&rsquo;s Services.
        <br />
        <br />
        This Privacy Policy explains what personal information we collect, how we use and share that
        information, and your choices concerning our information practices. <br />
        Before using our Services or submitting any personal information to SAGE, please review this
        Privacy Policy carefully and contact us if you have any questions. By creating a User
        Account, User and/or Artist profiles, or using the Services, you agree to the practices
        described in this Privacy Policy. If you do not agree to this Privacy Policy, please do not
        access the Services. This Privacy Policy is incorporated into and forms part of our Terms of
        Use.
      </p>

      <Group>
        <h2 className='submissions-page__guidelines-header'>Personal Information: Definition</h2>
        <Text>
          As used herein, &ldquo;Personal Information&rdquo; means information that identifies or is
          reasonably capable of identifying an individual, directly or indirectly, and information
          that is capable of being associated with an identified or reasonably identifiable
          individual.
        </Text>
      </Group>

      <Group>
        <Subheader>Header Personal Information We Collect From You</Subheader>
        <Text>
          We may collect the following categories of Personal Information directly from you:
        </Text>
        <List>
          <li>
            Identification Information such as name, email, digital wallet address, phone number,
            and postal address;
          </li>
          <li>Profile information;</li>
          <li>
            Commercial Activity such as trading activity, order activity, deposits, withdrawals, and
            account balances;
          </li>
          <li>
            Correspondence such as information you provide to us in correspondence, including
            account opening and customer support, as well as your responses to questionnaires,
            surveys, or market research requests; and
          </li>
          <li>Information such as images that you upload to your User Profile.</li>
        </List>
      </Group>
      <Group>
        <Subheader>Personal Information We Collect Automatically</Subheader>
        <Text>
          We may collect the following categories of Personal Information automatically through your
          use of our services:
        </Text>
        <List>
          <li>Online Identifiers such as IP address, domain name;</li>
          <li>
            Device Information such as hardware (manufacturer and model), operating system, browser
            type, IP address, and unique identifiers of the device you use to access the Services.
            The information we collect may vary based on your device type and settings. <br />
          </li>

          <li>
            Email Open/Click Information, to access your your email and IP address as well as the
            date and time you open an email or click on any links in emails;
          </li>

          <li>
            Usage Data such as system activity, internal and external information related to SAGE
            pages that you visit, the types of content that you view or engage with, the features
            you use, the actions you take, the time, frequency, and duration of your activities, and
            clickstream information; and
          </li>

          <li>Geolocation Data.</li>
        </List>
        <Text>
          Our automatic collection of Personal Information may involve the use of Cookies and Pixel
          Tags, described in greater detail below.
        </Text>
      </Group>
      <Group>
        <Subheader>Personal Information We Collect From Third Parties</Subheader>
        <Text>
          We may collect and/or verify the following categories of Personal Information about you
          from third parties, including service providers and our affiliates:
        </Text>
        <List>
          <li>Identification Information such as name, email, phone number, postal address;</li>

          <li>
            Social Media Information from platforms like Instagram and Twitter. When you interact
            with us on social media, we may receive personal information that you provide or make
            available to us based on your settings, such as your profile information. We also
            collect any social media profile information you directly provide us;
          </li>
          <li>
            Transaction Information such as public blockchain data. Bitcoin, ether, and other
            Digital Assets are not truly anonymous. We, and any others who can match your public
            Digital Asset address to other Personal Information about you, may be able to identify
            you from a blockchain transaction because, in some circumstances, Personal Information
            published on a blockchain (such as your Digital Asset address and IP address) can be
            correlated with Personal Information that we and others may have. Furthermore, by using
            data analysis techniques on a given blockchain, it may be possible to identify other
            Personal Information about you;
          </li>
          <li>
            Financial Information such as bank account information, routing number, credit card
            number, debit card number; and
          </li>
          <li>Additional Information at our discretion to comply with legal obligations.</li>
        </List>
      </Group>
      <Group>
        <Subheader>Accuracy and Retention of Personal Information</Subheader>
        <Text>
          We take reasonable and practicable steps to ensure that your Personal Information held by
          us is (i) accurate with regard to the purposes for which it is to be used, and (ii) not
          kept longer than is necessary for the fulfillment of the purpose for which it is to be
          used.
        </Text>
      </Group>

      <Group>
        <Subheader>How We Use Your Personal Information</Subheader>
        <Text>
          We collect Personal Information about you in an attempt to provide you with the best
          experience possible, protect you from risks related to improper use and fraud, and help us
          maintain and improve our Services. We may use your Personal Information to:
        </Text>
        <List>
          <li>
            We use your Personal Information to provide you with our Services pursuant to the terms
            of our Terms of Use.
          </li>
          <li>
            We process your Personal Information as required by applicable laws and regulations.
          </li>
          <li>We use your Personal Information to process transactions.</li>
          <li>
            We process your Personal Information to detect and prevent fraud on your account, which
            is especially important given the irreversible nature of cryptocurrency transactions.
          </li>
          <li>
            We use your Personal Information, including information about your device and your
            activity on with us to maintain the security of your account and the Services.
          </li>
          <li>
            We process your Personal Information when you contact our support team with questions
            about or issues with your account.
          </li>

          <li>
            We use your Personal Information to protect our, your, or others&rsquo; rights, privacy,
            safety or property (including by making and defending legal claims).
          </li>

          <li>
            We may contact you with information about our Services. We will only do so with your
            permission, which can be revoked at any time.
          </li>
          <li>
            We may use your Personal Information for additional purposes if that purpose is
            disclosed to you before we collect the information or if we obtain your consent.
          </li>
        </List>
      </Group>
      <Group>
        <Subheader>How We Share Your Personal Information</Subheader>
        <Text>
          SAGE will not share your Personal Information with third parties, except as described
          below:
        </Text>
        <List>
          <li>
            We may share your Personal Information with third-party service providers for business
            or commercial purposes, including fraud detection and prevention, security threat
            detection, payment processing, customer support, data analytics, Information Technology,
            advertising and marketing, network infrastructure, storage, and transaction monitoring.
            We share your Personal Information with these service providers only so that they can
            provide us with the services, and we prohibit our service providers from using or
            disclosing your Personal Information for any other purpose.
          </li>
          <li>
            In some circumstances, SAGE may share your contact information with Artists to
            facilitate the delivery of content under the Terms of Use.
          </li>
          <li>
            If you are an Artist, we may, at our sole discretion, share your personal information
            with individuals who claim that your digital artwork or content may infringe their
            intellectual property and other proprietary rights.
          </li>
          <li>
            We may share Personal Information about you with our affiliates in the ordinary course
            of business and offering our Services to you.
          </li>
          <li>
            We may be compelled to share your Personal Information with law enforcement, government
            officials, and regulators.
          </li>
          <li>
            We may disclose Personal Information in the event of a proposed or consummated merger,
            acquisition, reorganization, asset sale, or similar corporate transaction, or in the
            event of a bankruptcy or dissolution.
          </li>
          <li>
            We may share your Personal Information with our professional advisors, including legal,
            accounting, or other consulting services for purposes of audits or to comply with our
            legal obligations.
          </li>
          <li>We may share your Personal Information with your consent.</li>
          <Text>
            If we decide to modify the purpose for which your Personal Information is collected and
            used, we will amend this Privacy Policy.
          </Text>
        </List>
      </Group>
      <Group>
        <Subheader>Cookies and Pixel Tags</Subheader>
        <Text>
          When you access SAGE Services, we may make use of the standard practice of placing tiny
          data files called cookies, flash cookies, pixel tags, or other tracking tools (herein,
          &ldquo;Cookies&rdquo;) on your computer or other devices used to visit us. We use Cookies
          to help us recognize you as a customer, collect information about your use of our Services
          to better customize our Services and content for you, and collect information about your
          computer or other access devices to: (i) ensure that your account security has not been
          compromised by detecting irregular, suspicious, or potentially fraudulent account
          activities; and (ii) assess and improve our services and advertising campaigns. Please
          note that if you reject cookies, you will not be able to use some or all of our Services.
          If you do not consent to the placing of Cookies on your device, please do not visit,
          access, or use our Services.
        </Text>
        <Text>
          In addition to Cookies, we use &ldquo;Pixel Tags&rdquo; (also referred to as clear gifs,
          web beacons, or web bugs). Pixel Tags are tiny graphic images with a unique identifier,
          similar in function to Cookies, that are used to track online movements of Web users. In
          contrast to Cookies, which are stored on a user&rsquo;s computer hard drive, Pixel Tags
          are embedded invisibly in web pages. Pixel Tags also allow us to send e-mail messages in a
          format that users can read, and they tell us whether e-mails have been opened to ensure
          that we are sending only messages that are of interest to our users. We may use this
          information to reduce or eliminate messages sent to a user. We do not tie the information
          gathered by Pixel Tags to our users&rsquo; Personal Data.
        </Text>
      </Group>
      <Group>
        <Subheader>Information Security</Subheader>
        <Text>
          We employ a number of reasonable technical, organizational and physical safeguards
          designed to protect the personal information we collect and to guard against accidental
          loss or destruction of, or damage to, your personal data. However, no security is
          foolproof, and the Internet is an insecure medium. We cannot guarantee absolute security,
          but we work hard to protect SAGE and you from unauthorized access to or unauthorized
          alteration, disclosure, or destruction of Personal Information we collect and store.
          Measures we take include encryption of our website communications with SSL; optional
          two-factor authentication; periodic review of our Personal Information collection,
          storage, and processing practices; and restricted access to your Personal Information on a
          need-to-know basis for our employees, contractors and agents who are subject to strict
          contractual confidentiality obligations and may be disciplined or terminated if they fail
          to meet these obligations. Nevertheless, it remains your responsibility: (a) to protect
          against unauthorized access to your use of the Services; (b) to ensure no one else uses
          the Services while your device is logged on to SAGE (including by logging on to your
          device through a mobile, Wi-Fi, or shared access connection you are using); (c) to log off
          or exit from the Services when not using them; (d) where relevant, to keep your password
          or other access information secret (your password and log in details are personal to you
          and should not be given to anyone else or used to provide shared access for example over a
          network); and (e) to maintain good internet security.
        </Text>
        <Text>
          If you think that your user account has been compromised you should change your account
          credentials with us, and in particular make sure any compromised account does not allow
          access to your account with us. You should also tell us as soon as you can, so that we can
          try to help you keep your account secure and if necessary warn anyone else who could be
          affected.
        </Text>
      </Group>

      <Group>
        <Subheader>Children</Subheader>
        <Text>
          Our Services are not directed to children who are under the age of 18. SAGE does not
          knowingly collect personal information from children under the age of 18. If we learn that
          we have collected personal information from a child under the age of 18 without the
          consent of the child&rsquo;s parent or guardian as required by law, we will delete that
          information.
        </Text>
      </Group>
      <Group>
        <Subheader>Non-U.S. Users</Subheader>
        <Text>
          If you are a non-U.S. user of the Services, by providing us with data, you acknowledge and
          agree that your Personal Data may be processed for the purposes identified in the Privacy
          Policy. In addition, your Personal Data may be processed in the country in which it was
          collected and in other countries, including the United States, where laws regarding
          processing of Personal Data may be less stringent than the laws in your country. By
          providing your data, you consent to such
        </Text>
      </Group>
      <Group>
        <Subheader>Links to Other Websites</Subheader>
        <Text>
          The Services may contain links to other websites not operated or controlled by SAGE,
          including social media services (“Third Party Sites”). The information that you share with
          Third Party Sites will be governed by the specific privacy policies and terms of service
          of the Third Party Sites and not by this Privacy Policy. By providing these links we do
          not imply that we endorse or have reviewed these sites. Please contact the Third Party
          Sites directly for information on their privacy practices and policies.
        </Text>
      </Group>
      <Group>
        <Subheader>Changes to the Privacy Policy</Subheader>
        <Text>
          The Services may change from time to time. As a result, we may change this Privacy Policy
          at any time. When we do we will post an updated version on this page, unless another type
          of notice is required by applicable law. By continuing to use our Services or providing us
          with personal information after we have posted an updated Privacy Policy, or notified you
          by other means if applicable, you consent to the revised Privacy Policy and the practices
          described in it.
        </Text>
      </Group>
      <Group>
        <Subheader>Contact Us</Subheader>
        <Text>
          If you have any questions about our Privacy Policy or information practices, please feel
          free to contact us at our designated request address:
          <a href='mailto:privacy@sage.art'> privacy@sage.art</a>
        </Text>
      </Group>
    </>
  );
}
