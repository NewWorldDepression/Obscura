/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ui.robots

import android.util.Log
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertAny
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.pressImeActionButton
import androidx.test.espresso.matcher.RootMatchers
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiSelector
import androidx.test.uiautomator.Until
import org.mozilla.fenix.R
import org.mozilla.fenix.helpers.Constants.TAG
import org.mozilla.fenix.helpers.MatcherHelper.assertItemTextEquals
import org.mozilla.fenix.helpers.MatcherHelper.assertUIObjectExists
import org.mozilla.fenix.helpers.MatcherHelper.assertUIObjectIsGone
import org.mozilla.fenix.helpers.MatcherHelper.itemContainingText
import org.mozilla.fenix.helpers.MatcherHelper.itemWithResId
import org.mozilla.fenix.helpers.MatcherHelper.itemWithText
import org.mozilla.fenix.helpers.TestAssetHelper.waitingTime
import org.mozilla.fenix.helpers.TestHelper.mDevice
import org.mozilla.fenix.helpers.TestHelper.packageName
import org.mozilla.fenix.helpers.click
import org.mozilla.fenix.helpers.ext.waitNotNull

class CollectionRobot {

    fun verifySelectCollectionScreen() =
        assertUIObjectExists(
            itemContainingText("Select collection"),
            itemContainingText("Add new collection"),
            itemWithResId("$packageName:id/collections_list"),
        )

    fun clickAddNewCollection() {
        Log.i(TAG, "clickAddNewCollection: Trying to click the add new collection button")
        addNewCollectionButton().click()
        Log.i(TAG, "clickAddNewCollection: Clicked the add new collection button")
    }

    fun verifyCollectionNameTextField() = assertUIObjectExists(mainMenuEditCollectionNameField())

    // names a collection saved from tab drawer
    fun typeCollectionNameAndSave(collectionName: String) {
        Log.i(TAG, "typeCollectionNameAndSave: Trying to set collection name text field to: $collectionName")
        collectionNameTextField().setText(collectionName)
        Log.i(TAG, "typeCollectionNameAndSave: Collection name text field set to: $collectionName")
        Log.i(TAG, "typeCollectionNameAndSave: Waiting for $waitingTime ms for add collection button panel to exist")
        addCollectionButtonPanel().waitForExists(waitingTime)
        Log.i(TAG, "typeCollectionNameAndSave: Waited for $waitingTime ms for add collection button panel to exist")
        Log.i(TAG, "typeCollectionNameAndSave: Trying to click \"OK\" panel button")
        addCollectionOkButton().click()
        Log.i(TAG, "typeCollectionNameAndSave: Clicked \"OK\" panel button")
    }

    fun verifyTabsSelectedCounterText(numOfTabs: Int) {
        Log.i(TAG, "verifyTabsSelectedCounterText: Waiting for $waitingTime ms for \"Select tabs to save\" prompt to be gone")
        itemWithText("Select tabs to save").waitUntilGone(waitingTime)
        Log.i(TAG, "verifyTabsSelectedCounterText: Waited for $waitingTime ms for \"Select tabs to save\" prompt to be gone")

        val tabsCounter = mDevice.findObject(UiSelector().resourceId("$packageName:id/bottom_bar_text"))
        Log.i(TAG, "verifyTabsSelectedCounterText: Trying to assert that number of tabs selected is: $numOfTabs")
        when (numOfTabs) {
            1 -> assertItemTextEquals(tabsCounter, expectedText = "$numOfTabs tab selected")
            2 -> assertItemTextEquals(tabsCounter, expectedText = "$numOfTabs tabs selected")
        }
        Log.i(TAG, "verifyTabsSelectedCounterText: Asserted number of tabs selected is: $numOfTabs")
    }

    fun saveTabsSelectedForCollection() {
        Log.i(TAG, "saveTabsSelectedForCollection: Trying to click \"Save\" button")
        itemWithResId("$packageName:id/save_button").click()
        Log.i(TAG, "saveTabsSelectedForCollection: Clicked \"Save\" button")
    }

    @OptIn(ExperimentalTestApi::class)
    fun verifyTabSavedInCollection(composeTestRule: ComposeTestRule, title: String, visible: Boolean = true) {
        if (visible) {
            Log.i(TAG, "verifyTabSavedInCollection: Waiting for $waitingTime until tab with title: $title exists")
            composeTestRule.waitUntilAtLeastOneExists(hasText(title), waitingTime)
            Log.i(TAG, "verifyTabSavedInCollection: Waited for $waitingTime until tab with title: $title exists")
            Log.i(TAG, "verifyTabSavedInCollection: Trying to verify that tab with title: $title is displayed")
            composeTestRule.onNodeWithText(title).assertIsDisplayed()
            Log.i(TAG, "verifyTabSavedInCollection: Verified that tab with title: $title is displayed")
        } else {
            Log.i(TAG, "verifyTabSavedInCollection: Waiting for $waitingTime until tab with title: $title does not exists")
            composeTestRule.waitUntilDoesNotExist(hasText(title), waitingTime)
            Log.i(TAG, "verifyTabSavedInCollection: Waited for $waitingTime until tab with title: $title does not exists")
            Log.i(TAG, "verifyTabSavedInCollection: Trying to verify that tab with title: $title is not displayed")
            composeTestRule.onNodeWithText(title).assertIsNotDisplayed()
            Log.i(TAG, "verifyTabSavedInCollection: Verified that tab with title: $title is not displayed")
        }
    }

    @OptIn(ExperimentalTestApi::class)
    fun verifyCollectionTabUrl(composeTestRule: ComposeTestRule, isDisplayed: Boolean, url: String) {
        if (isDisplayed) {
            Log.i(TAG, "verifyCollectionTabUrl: Waiting for $waitingTime until tab with url: $url exists")
            composeTestRule.waitUntilAtLeastOneExists(hasText(url))
            Log.i(TAG, "verifyCollectionTabUrl: Waited for $waitingTime until tab with url: $url exists")
            Log.i(TAG, "verifyCollectionTabUrl: Trying to verify that the node with text: $url has text: $url")
            composeTestRule.onAllNodesWithText(url).assertAny(hasText(url))
            Log.i(TAG, "verifyCollectionTabUrl: Verified that the node with text: $url has text: $url")
        } else {
            Log.i(TAG, "verifyCollectionTabUrl: Waiting for $waitingTime until tab with url: $url does not exist")
            composeTestRule.waitUntilDoesNotExist(hasText(url))
            Log.i(TAG, "verifyCollectionTabUrl: Waited for $waitingTime until tab with url: $url does not exist")
            Log.i(TAG, "verifyCollectionTabUrl: Trying to verify that the tab with url: $url is not displayed")
            composeTestRule.onNodeWithText(url).assertIsNotDisplayed()
            Log.i(TAG, "verifyCollectionTabUrl: Verified that the tab with url: $url is not displayed")
        }
    }

    fun verifyShareCollectionButtonIsVisible(composeTestRule: ComposeTestRule, visible: Boolean) {
        if (visible) {
            Log.i(TAG, "verifyShareCollectionButtonIsVisible: Trying to verify that the share button is displayed")
            composeTestRule.onNodeWithContentDescription("Share").assertIsDisplayed()
            Log.i(TAG, "verifyShareCollectionButtonIsVisible: Verified that the share button is displayed")
        } else {
            Log.i(TAG, "verifyShareCollectionButtonIsVisible: Trying to verify that the share button is not displayed")
            composeTestRule.onNodeWithContentDescription("Share").assertIsNotDisplayed()
            Log.i(TAG, "verifyShareCollectionButtonIsVisible: Verified that the share button is not displayed")
        }
    }

    fun verifyCollectionMenuIsVisible(visible: Boolean, rule: ComposeTestRule) {
        if (visible) {
            Log.i(TAG, "verifyCollectionMenuIsVisible: Trying to verify collection three dot button exists")
            collectionThreeDotButton(rule).assertExists()
            Log.i(TAG, "verifyCollectionMenuIsVisible: Verified collection three dot button exists")
            Log.i(TAG, "verifyCollectionMenuIsVisible: Trying to verify collection three dot button is displayed")
            collectionThreeDotButton(rule).assertIsDisplayed()
            Log.i(TAG, "verifyCollectionMenuIsVisible: Verified collection three dot button is displayed")
        } else {
            Log.i(TAG, "verifyCollectionMenuIsVisible: Trying to verify collection three dot button does not exist")
            collectionThreeDotButton(rule)
                .assertDoesNotExist()
            Log.i(TAG, "verifyCollectionMenuIsVisible: Verified collection three dot button does not exist")
        }
    }

    fun clickCollectionThreeDotButton(rule: ComposeTestRule) {
        Log.i(TAG, "clickCollectionThreeDotButton: Trying to verify three dot button is displayed")
        collectionThreeDotButton(rule).assertIsDisplayed()
        Log.i(TAG, "clickCollectionThreeDotButton: Verified three dot button is displayed")
        Log.i(TAG, "clickCollectionThreeDotButton: Trying to click three dot button")
        collectionThreeDotButton(rule).performClick()
        Log.i(TAG, "clickCollectionThreeDotButton: Clicked three dot button")
    }

    fun selectOpenTabs(rule: ComposeTestRule) {
        Log.i(TAG, "selectOpenTabs: Trying to verify \"Open tabs\" menu option is displayed")
        rule.onNode(hasText("Open tabs")).assertIsDisplayed()
        Log.i(TAG, "selectOpenTabs: Verified \"Open tabs\" menu option is displayed")
        Log.i(TAG, "selectOpenTabs: Trying to click \"Open tabs\" menu option")
        rule.onNode(hasText("Open tabs")).performClick()
        Log.i(TAG, "selectOpenTabs: Clicked \"Open tabs\" menu option")
    }

    fun selectRenameCollection(rule: ComposeTestRule) {
        Log.i(TAG, "selectRenameCollection: Trying to verify \"Rename collection\" menu option is displayed")
        rule.onNode(hasText("Rename collection")).assertIsDisplayed()
        Log.i(TAG, "selectRenameCollection: Verified \"Rename collection\" menu option is displayed")
        Log.i(TAG, "selectRenameCollection: Trying to click \"Rename collection\" menu option")
        rule.onNode(hasText("Rename collection")).performClick()
        Log.i(TAG, "selectRenameCollection: Clicked \"Rename collection\" menu option")
        Log.i(TAG, "selectRenameCollection: Waiting for $waitingTime ms for collection name text field to exist")
        mainMenuEditCollectionNameField().waitForExists(waitingTime)
        Log.i(TAG, "selectRenameCollection: Waited for $waitingTime ms for collection name text field to exist")
    }

    @OptIn(ExperimentalTestApi::class)
    fun selectAddTabToCollection(rule: ComposeTestRule) {
        Log.i(TAG, "selectAddTabToCollection: Trying to verify \"Add tab\" menu option is displayed")
        rule.onNode(hasText("Add tab")).assertIsDisplayed()
        Log.i(TAG, "selectAddTabToCollection: Verified \"Add tab\" menu option is displayed")
        Log.i(TAG, "selectAddTabToCollection: Trying to click \"Add tab\" menu option")
        rule.onNode(hasText("Add tab")).performClick()
        Log.i(TAG, "selectAddTabToCollection: Clicked \"Add tab\" menu option")
        Log.i(TAG, "selectAddTabToCollection: Waiting for the \"Add tab\" menu option to not exist")
        rule.waitUntilDoesNotExist(hasText("Add tab"))
        Log.i(TAG, "selectAddTabToCollection: Waited for the \"Add tab\" menu option to not exist")
    }

    @OptIn(ExperimentalTestApi::class)
    fun selectDeleteCollection(rule: ComposeTestRule) {
        Log.i(TAG, "selectDeleteCollection: Trying to verify \"Delete collection\" menu option is displayed")
        rule.onNode(hasText("Delete collection")).assertIsDisplayed()
        Log.i(TAG, "selectDeleteCollection: Verified \"Delete collection\" menu option is displayed")
        Log.i(TAG, "selectDeleteCollection: Trying to click \"Delete collection\" menu option")
        rule.onNode(hasText("Delete collection")).performClick()
        Log.i(TAG, "selectDeleteCollection: Clicked \"Delete collection\" menu option")
        Log.i(TAG, "selectDeleteCollection: Waiting for the \"Delete collection\" menu option to not exist")
        rule.waitUntilDoesNotExist(hasText("Delete collection"))
        Log.i(TAG, "selectDeleteCollection: Waited for the \"Delete collection\" menu option to not exist")
    }

    fun verifyCollectionItemRemoveButtonIsVisible(title: String, visible: Boolean) {
        if (visible) {
            assertUIObjectExists(removeTabFromCollectionButton(title), exists = true)
        } else {
            assertUIObjectIsGone(removeTabFromCollectionButton(title))
        }
    }

    fun removeTabFromCollection(title: String) {
        Log.i(TAG, "removeTabFromCollection: Trying to click remove button for tab: $title")
        removeTabFromCollectionButton(title).click()
        Log.i(TAG, "removeTabFromCollection: Clicked remove button for tab: $title")
    }

    fun swipeTabLeft(title: String, rule: ComposeTestRule) {
        Log.i(TAG, "swipeTabLeft: Trying to remove tab: $title using swipe left action")
        rule.onNode(hasText(title), useUnmergedTree = true)
            .performTouchInput { swipeLeft() }
        Log.i(TAG, "swipeTabLeft: Removed tab: $title using swipe left action")
        Log.i(TAG, "swipeTabLeft: Waiting for rule to be idle")
        rule.waitForIdle()
        Log.i(TAG, "swipeTabLeft: Waited for rule to be idle")
    }

    fun swipeTabRight(title: String, rule: ComposeTestRule) {
        Log.i(TAG, "swipeTabRight: Trying to remove tab: $title using swipe right action")
        rule.onNode(hasText(title), useUnmergedTree = true)
            .performTouchInput { swipeRight() }
        Log.i(TAG, "swipeTabRight: Removed tab: $title using swipe right action")
        Log.i(TAG, "swipeTabRight: Waiting for rule to be idle")
        rule.waitForIdle()
        Log.i(TAG, "swipeTabRight: Waited for rule to be idle")
    }

    fun goBackInCollectionFlow() {
        Log.i(TAG, "goBackInCollectionFlow: Trying to click collection creation flow back button")
        backButton().click()
        Log.i(TAG, "goBackInCollectionFlow: Clicked collection creation flow back button")
    }

    class Transition {
        fun collapseCollection(
            composeTestRule: ComposeTestRule,
            title: String,
            interact: HomeScreenRobot.() -> Unit,
        ): HomeScreenRobot.Transition {
            Log.i(TAG, "collapseCollection: Trying to click the collection with title: $title")
            composeTestRule.onNodeWithText(title).performClick()
            Log.i(TAG, "collapseCollection: Clicked the collection with title: $title")
            Log.i(TAG, "collapseCollection: Waiting for compose test rule to be idle")
            composeTestRule.waitForIdle()
            Log.i(TAG, "collapseCollection: Waiting for compose test rule to be idle")

            HomeScreenRobot().interact()
            return HomeScreenRobot.Transition()
        }

        // names a collection saved from the 3dot menu
        fun typeCollectionNameAndSave(
            name: String,
            interact: BrowserRobot.() -> Unit,
        ): BrowserRobot.Transition {
            Log.i(TAG, "typeCollectionNameAndSave: Waiting for $waitingTime ms for collection name text field to exist")
            mainMenuEditCollectionNameField().waitForExists(waitingTime)
            Log.i(TAG, "typeCollectionNameAndSave: Waited for $waitingTime ms for collection name text field to exist")
            Log.i(TAG, "typeCollectionNameAndSave: Trying to set collection name text field to: $name")
            mainMenuEditCollectionNameField().setText(name)
            Log.i(TAG, "typeCollectionNameAndSave: Collection name text field set to: $name")
            Log.i(TAG, "typeCollectionNameAndSave: Trying to press done action button")
            onView(withId(R.id.name_collection_edittext)).perform(pressImeActionButton())
            Log.i(TAG, "typeCollectionNameAndSave: Pressed done action button")

            // wait for the collection creation wrapper to be dismissed
            mDevice.waitNotNull(Until.gone(By.res("$packageName:id/createCollectionWrapper")))

            BrowserRobot().interact()
            return BrowserRobot.Transition()
        }

        fun selectExistingCollection(
            title: String,
            interact: BrowserRobot.() -> Unit,
        ): BrowserRobot.Transition {
            Log.i(TAG, "selectExistingCollection: Waiting for $waitingTime ms for collection with title: $title to exist")
            collectionTitle(title).waitForExists(waitingTime)
            Log.i(TAG, "selectExistingCollection: Waited for $waitingTime ms for collection with title: $title to exist")
            Log.i(TAG, "selectExistingCollection: Trying to click collection with title: $title")
            collectionTitle(title).click()
            Log.i(TAG, "selectExistingCollection: Clicked collection with title: $title")

            BrowserRobot().interact()
            return BrowserRobot.Transition()
        }

        @OptIn(ExperimentalTestApi::class)
        fun clickShareCollectionButton(composeTestRule: ComposeTestRule, interact: ShareOverlayRobot.() -> Unit): ShareOverlayRobot.Transition {
            Log.i(TAG, "clickShareCollectionButton: Waiting for $waitingTime ms for share collection button to exist")
            composeTestRule.waitUntilExactlyOneExists(hasContentDescription("Share"), waitingTime)
            Log.i(TAG, "clickShareCollectionButton: Waited for $waitingTime ms for share collection button to exist")
            Log.i(TAG, "clickShareCollectionButton: Trying to click share collection button")
            composeTestRule.onNodeWithContentDescription("Share").performClick()
            Log.i(TAG, "clickShareCollectionButton: Clicked share collection button")

            ShareOverlayRobot().interact()
            return ShareOverlayRobot.Transition()
        }
    }
}

fun collectionRobot(interact: CollectionRobot.() -> Unit): CollectionRobot.Transition {
    CollectionRobot().interact()
    return CollectionRobot.Transition()
}

private fun collectionTitle(title: String) = itemWithText(title)

private fun collectionThreeDotButton(rule: ComposeTestRule) =
    rule.onNode(hasContentDescription("Collection menu"))

private fun collectionListItem(title: String) = mDevice.findObject(UiSelector().text(title))

private fun removeTabFromCollectionButton(title: String) =
    mDevice.findObject(
        UiSelector().text(title),
    ).getFromParent(
        UiSelector()
            .description("Remove tab from collection"),
    )

// collection name text field, opened from tab drawer
private fun collectionNameTextField() =
    mDevice.findObject(
        UiSelector().resourceId("$packageName:id/collection_name"),
    )

// collection name text field, when saving from the main menu option
private fun mainMenuEditCollectionNameField() =
    itemWithResId("$packageName:id/name_collection_edittext")

private fun addNewCollectionButton() =
    mDevice.findObject(UiSelector().text("Add new collection"))

private fun backButton() =
    mDevice.findObject(
        UiSelector().resourceId("$packageName:id/back_button"),
    )
private fun addCollectionButtonPanel() =
    itemWithResId("$packageName:id/buttonPanel")

private fun addCollectionOkButton() = onView(withId(android.R.id.button1)).inRoot(RootMatchers.isDialog())
